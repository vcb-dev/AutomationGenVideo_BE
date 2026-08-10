# Gom Facebook app secret về BE — Thiết kế

> ## ⛔ KHÔNG THI CÔNG — dừng ngày 10/08/2026
>
> Thiết kế này xây trên một giả định **sai**: rằng token hệ thống là loại 60 ngày và sẽ chết
> âm thầm khi hết hạn. Đo bằng `debug_token` ngay trong ngày viết spec:
>
> ```
> is_valid   = true
> expires_at = 0   →  KHÔNG BAO GIỜ HẾT HẠN
> ```
>
> Token vĩnh viễn kéo theo phần lớn thiết kế trở nên vô nghĩa:
>
> - **Cảnh báo Lark khi token hết hạn** — không hết hạn thì gần như không bao giờ nổ.
> - **Ngưỡng 7 ngày, `last_alert_at`, nhắc lại mỗi tuần** — giải quyết vấn đề không tồn tại.
> - **Bug ổ đĩa tạm** — mất `.fb_token.json` thì rơi về `META_ACCESS_TOKEN`, mà token đó
>   vĩnh viễn hợp lệ. Không sao cả.
> - **Cron gia hạn 05:30** — hiện gọi Facebook mỗi ngày để gia hạn thứ không cần gia hạn.
>   Tệ hơn: không có file state nên `get_expires_at()` trả `None`, bỏ qua luôn kiểm ngưỡng.
>
> Phần còn đúng — AI giữ app secret nên đúc được token mới — là rủi ro thật nhưng trừu tượng,
> không xứng với 5 task / 43 bước và một đợt deploy hai pha qua hai repo.
>
> **Rủi ro lớn hơn tìm ra trong lúc khảo sát, chưa xử lý:** token vĩnh viễn đó mang các scope
> `ads_management`, `pages_manage_posts`, `pages_manage_ads`, `instagram_content_publish`,
> `leads_retrieval` — đăng bài, chạy quảng cáo, đọc data khách hàng tiềm năng — và nằm dạng
> thô trong `AutomationGenVideo_AI/.env`. Lộ ra là mất quyền đó **vĩnh viễn** cho tới khi có
> người thủ công vào Facebook thu hồi. Đã kiểm: token **không** bị commit vào git ở cả ba repo.
>
> Muốn làm gì với hướng này thì nên nhắm vào rủi ro trên — đổi token vĩnh viễn quyền cao
> thành token có hạn, thu hẹp scope xuống đúng `pages_show_list` + `pages_read_engagement`
> mà AI thật sự cần — chứ không phải gom app secret. Đó là bài toán khác, cần brainstorm lại.
>
> Kế hoạch thi công: [2026-08-10-gom-facebook-app-secret-be-plan.md](2026-08-10-gom-facebook-app-secret-be-plan.md) — cũng không thi công.



**Mục tiêu:** `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` chỉ còn tồn tại ở BE. AI thôi giữ bí mật dài hạn và thôi giữ trạng thái — mọi thao tác Graph API dùng token do BE truyền sang theo từng request.

**Kiến trúc:** BE là nơi duy nhất giữ bí mật và trạng thái. AI trở thành bộ chuyển tiếp Graph API thuần: nhận token, gọi, trả kết quả, không nhớ gì giữa các lần gọi.

**Tech:** NestJS + Prisma (BE) · Django + DRF (AI) · Facebook Graph API v21/v25

## Hiện trạng đã đo được (10/08/2026)

Mọi con số dưới đây lấy bằng chạy thật, không phải đọc code.

| Việc | Sự thật đo được |
|---|---|
| AI dùng app secret ở đâu | **Đúng 2 chỗ**: `refresh_user_token()` (đổi token dài hạn) và `FacebookGraphService.__init__` (chỉ là cổng kiểm tra, ném `ValueError` khi thiếu) |
| `_generate_app_access_token()` | Chỉ chạy khi **không có token nào cả** — mọi đường từ BE đều đã có token |
| BE truyền token sang AI chưa | **Rồi**, 5/6 luồng gửi `page_access_token_encrypted`; `managed-pages` gửi `user_access_token` nhưng đang để tuỳ chọn |
| AI có honour token từ body không | **Có** — đo bằng cách gọi thật: không kèm token trả về page thật, kèm token giả trả `{"pages":[]}` |
| BE tự giải mã token của mình | **Được** — `CryptoService` AES-256-GCM, khoá `SOCIAL_TOKEN_SECRET`, round-trip khớp |
| Scope OAuth sẵn có của BE | `pages_show_list`, `pages_read_engagement` — **đúng hai scope AI cần** (xem lỗi ở `facebook_graph_service.py:214, 815`) |
| Token store của AI | File `/app/.fb_token.json`, `WORKDIR /app`, `railway.toml` **không khai volume** → mất sau mỗi lần deploy |
| Cặp app trùng nhau | `AI.FACEBOOK_APP_ID` và `BE.FB_APP_ID` cùng giá trị (đối chiếu bằng hash) — một app Meta, hai tên biến, hai nơi |

**Hai lỗi có sẵn phát hiện trong lúc khảo sát:**

1. **Lỗi xác thực bị nuốt.** `get_my_managed_pages` bắt `HTTPError` rồi `return []`, nên Facebook trả 400 code 190 "Invalid OAuth access token" mà AI vẫn đáp **HTTP 200 kèm danh sách rỗng**. BE không phân biệt được "token chết" với "không quản lý page nào". Không mất dữ liệu (`facebook-owned-pages.service.ts:35` thoát sớm khi rỗng, không xoá page nào) nhưng import báo `created: 0, updated: 0` trông y hệt một lần chạy bình thường.

2. **Cấu hình chết.** `AI/.env` khai `FACEBOOK_ACCESS_TOKEN` (246 ký tự) nhưng `settings.py:338` ghi `FACEBOOK_ACCESS_TOKEN = META_ACCESS_TOKEN` (196 ký tự) — dòng trong `.env` không bao giờ được đọc.

## Bốn quyết định thiết kế

| Quyết định | Chọn | Vì sao |
|---|---|---|
| Token nằm ở đâu | **BE giữ trong DB, truyền sang mỗi request** | AI thành không trạng thái; sửa luôn bug ổ đĩa tạm mà không phải làm gì thêm |
| Token lấy từ đâu | **OAuth sẵn có của BE** | Scope đã đúng sẵn. Token chết thì admin bấm kết nối lại, không phải sửa env rồi deploy |
| Chỉ định tài khoản hệ thống | **Bảng cấu hình một dòng** | `is_shared` đã mang nghĩa "ai cũng đăng bài được", mượn lại sẽ nhập nhằng khi có nhiều tài khoản Facebook |
| Khi token chết | **Báo Lark cho admin** | Facebook không có refresh token — bắt buộc người thật đăng nhập lại. Chỉ ghi log thì không ai biết |

## Luồng dữ liệu

```
Admin bấm "Kết nối Facebook" (UI social-publishing sẵn có)
   │  scope: pages_show_list, pages_read_engagement, business_management, ...
   ▼
BE facebook.strategy.exchangeCode()  ──> token dài hạn 60 ngày
   ▼
social_accounts.access_token_enc          (bảng sẵn có, đã mã hoá AES-256-GCM)
   ▲
   │ trỏ tới
facebook_system_account (bảng MỚI, đúng 1 dòng)
   ▼
BE cron 05:30  ── còn ≤ 7 ngày ──> fb_exchange_token (FB_APP_SECRET của BE)
   │                                └─ token chết ──> LarkNotifyService báo admin
   ▼
Mọi lời gọi sang AI đều kèm token trong body
   ▼
AI: không giữ token, không giữ app secret — chỉ chuyển tiếp Graph API
```

**Token gửi sang AI ở dạng thô.** `user_access_token` hiện đã được AI đọc thẳng không giải mã (`facebook_fetch_views.py:126`), nên BE không cần khoá Fernet. Riêng `page_access_token_encrypted` vẫn là chuỗi Fernet do AI tạo và BE chỉ forward nguyên văn — **không đụng tới trong phạm vi này**.

AI **vẫn giữ khoá Fernet**. Cái thu về là AI hết khả năng *đúc* token mới, không phải hết đọc được token. App secret là bí mật vĩnh viễn đúc được token cho mọi thứ app được cấp quyền; page token thì phạm vi hẹp, hết hạn, thu hồi được từng cái.

## Bảng mới

```prisma
/// Trỏ tới tài khoản Facebook được dùng làm "tài khoản hệ thống" cho 9 endpoint
/// đồng bộ ở AI. Bảng một dòng thay vì cột trên social_accounts: đó là bảng dùng
/// chung cho mọi nền tảng, nhét khái niệm riêng của Facebook vào sẽ lan ra dần.
model FacebookSystemAccount {
  id         String   @id @default(uuid()) @db.Uuid
  account_id String   @unique
  /// Ai đặt và đặt lúc nào — để tra khi có sự cố "sao token lại là của người này".
  set_by     String   @db.Uuid
  set_at     DateTime @default(now())
  /// Lần cuối bắn cảnh báo Lark. Cron chạy hằng ngày; token chết một tháng mà không
  /// có cột này là ba mươi tin giống hệt, đọc vài hôm người ta tắt thông báo — đúng
  /// lúc cần nhất thì không ai nhìn.
  last_alert_at DateTime?

  account SocialAccount @relation(fields: [account_id], references: [id], onDelete: Cascade)

  @@map("facebook_system_account")
}
```

`account_id` để `String` **không** kèm `@db.Uuid`: `SocialAccount.id` khai `String @id @default(uuid())` không có `@db.Uuid` nên cột đó là TEXT trong DB. Đặt lệch kiểu là FK nổ mã 42804 `incompatible types` — đúng cái đã làm chết migration `add_character_admin_crud` hôm 10/08.

Phải thêm chiều ngược lại vào `model SocialAccount`, Prisma bắt khai cả hai:

```prisma
  facebook_system FacebookSystemAccount?
```

Đây là trường quan hệ ở tầng schema, **không sinh cột nào** trên bảng `social_accounts` — migration chỉ có `CREATE TABLE` + `CREATE INDEX` + FK.

**Luật bắn cảnh báo, viết rõ để không hiểu hai cách:**

- `last_alert_at = NULL` và gia hạn hỏng vì token chết → bắn Lark, ghi `last_alert_at = now()`
- `last_alert_at` đã có và cách đây < 7 ngày → **im lặng**
- `last_alert_at` đã có và cách đây ≥ 7 ngày → bắn lại, cập nhật `last_alert_at`
- Gia hạn **thành công** → đặt lại `last_alert_at = NULL` để lần chết sau lại báo ngay

## Thứ tự triển khai

```
Pha 1 — chỉ sửa BE. AI KHÔNG đụng gì và vẫn chạy đúng.
Pha 2 — gỡ khỏi AI, sau khi pha 1 đã chạy ổn.
```

Hai pha chứ không phải một, vì `fetch_managed_pages` của AI **đã** honour `user_access_token` từ body (đo được). Nên BE gửi thêm trường đó không phá vỡ gì; AI chỉ gỡ fallback sau khi chắc chắn BE luôn gửi. Không có cửa sổ nào hệ thống hỏng, và pha 1 tự đứng được nếu muốn dừng giữa chừng.

Làm ngược lại — gỡ fallback ở AI trước — thì giữa hai lần deploy AI đòi token mà BE chưa gửi: chết ngay. Hai repo deploy bằng hai workflow riêng nên không đảm bảo được thứ tự.

### Pha 1 — BE

| File | Trạng thái | Trách nhiệm |
|---|---|---|
| `prisma/schema.prisma` + migration | Tạo | `model FacebookSystemAccount` |
| `facebook-system-account.service.ts` | Tạo | Đọc/đặt tài khoản hệ thống; trả token đã giải mã |
| `facebook-system-token.service.ts` | Tạo | Gia hạn bằng `fb_exchange_token`; ghi lại `access_token_enc` + `token_expires_at` |
| `accounts.controller.ts` | Sửa | `PUT /api/social/accounts/:id/facebook-system` — chỉ định tài khoản hệ thống. Chặn bằng `RolesGuard` + `ADMIN`; từ chối nếu account không phải `platform = FACEBOOK` hoặc `is_active = false` |
| `facebook-owned-pages-cron.service.ts:24-36` | Sửa | Cron 05:30 gọi service mới thay `aiClient.refreshUserToken()`; hỏng thì bắn Lark |
| `facebook-ai-client.service.ts:57-66` | Sửa | `fetchManagedPages()` **luôn** kèm `user_access_token` đã giải mã |
| `facebook-owned-pages.module.ts` | Sửa | Nối `CryptoService` và `LarkNotifyService` |

### Pha 2 — AI

| File | Trạng thái |
|---|---|
| `services/facebook_token_store.py` | **Xoá** — cùng `.fb_token.json` và `tests/test_facebook_token_store.py` |
| `views/facebook_fetch_views.py:31-38` | **Xoá** view `fetch_token_refresh` + route `facebook/fetch/token-refresh/` |
| `services/facebook_graph_service.py:84-131` | Sửa — `__init__` thôi đọc app creds, bỏ `raise ValueError`, xoá `_generate_app_access_token()` |
| `services/facebook_graph_service.py:812-822` | Sửa — lỗi 401/403/code 190 **ném lên**, không `return []` |
| `views/facebook_fetch_views.py:126-131` | Sửa — `user_access_token` **bắt buộc**, thiếu thì 400; lỗi xác thực trả 502 kèm mã Facebook |
| `core/settings.py:336-338` + `.env` | **Xoá** `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_ACCESS_TOKEN` |

## Xử lý lỗi

| Tình huống | Phản hồi |
|---|---|
| Chưa chỉ định tài khoản hệ thống | Cron ghi `warn` rồi thoát, **không** gọi Graph. Endpoint trả 400 nói rõ cần bấm kết nối |
| Tài khoản đã chỉ định bị xoá hoặc `is_active = false` | Coi như chưa chỉ định — cùng nhánh trên |
| Token còn > 7 ngày | Bỏ qua, không gọi Facebook lần nào |
| Token còn ≤ 7 ngày, đổi được | Ghi đè `access_token_enc` + `token_expires_at` |
| Đổi hỏng vì mạng / 5xx | Coi là **tạm**. Lượt sau thử lại, **không** báo Lark |
| Đổi hỏng vì token chết (code 190, hoặc phản hồi thiếu `access_token`) | Báo Lark tới `LARK_NOTIFY_OPEN_ID` (cùng người nhận báo cáo tuần), nội dung kèm link trang kết nối social để bấm thẳng. **KHÔNG ghi đè token cũ** — giữ để còn `debug_token` ra nguyên nhân |
| Vẫn hỏng ở các lượt sau | Im lặng, nhắc lại sau 7 ngày (`last_alert_at`) |
| AI nhận request thiếu `user_access_token` (sau pha 2) | 400 kèm tên trường thiếu |
| Facebook từ chối token khi AI gọi Graph (sau pha 2) | 502 kèm mã lỗi Facebook — **không** còn nuốt thành 200 + rỗng |

## Test — 1 chức năng = 1 file riêng

| File test | Kiểm cái gì |
|---|---|
| `BE/src/modules/facebook-owned-pages/__tests__/facebook-system-account.spec.ts` | Chỉ định và đổi tài khoản hệ thống; luôn đúng một dòng; tài khoản inactive coi như chưa có |
| `BE/src/modules/facebook-owned-pages/__tests__/refresh-system-token.spec.ts` | Ngưỡng 7 ngày; đổi được thì ghi đè; **hỏng thì KHÔNG ghi đè**; lỗi mạng khác lỗi token chết |
| `BE/src/modules/facebook-owned-pages/__tests__/token-dead-alert.spec.ts` | Báo Lark khi chuyển sang hỏng; im lặng lượt sau; nhắc lại sau 7 ngày; lỗi mạng tạm thì không báo |
| `AI/tests/test_facebook_token_required.py` | Thiếu `user_access_token` → 400; có thì dùng đúng token đó; không đọc `settings.FACEBOOK_APP_*` |
| `AI/tests/test_facebook_auth_error_propagates.py` | Token chết → **không** được trả 200; danh sách rỗng thật → vẫn 200 |

Ba file test BE dùng prisma giả và axios giả, cùng lối với `facebook-owned-pages-cron.service.spec.ts` sẵn có — không cần DB thật.

## Ngoài phạm vi

- Bỏ mã hoá Fernet cho `page_access_token` (đánh đổi khác, người viết đã cố ý chọn mã hoá khi truyền)
- Gom `FB_APP_ID`/`FB_APP_SECRET` với các nền tảng social khác (TikTok, Threads, Zalo)
- Đổi cơ chế phân quyền cho endpoint chỉ định tài khoản hệ thống — dùng `RolesGuard` sẵn có
