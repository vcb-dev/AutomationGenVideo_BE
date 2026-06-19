# BUGS — Bug Hunt Loop

**Scope (confirmed):** Toàn bộ Backend `AutomationGenVideo_BE` (NestJS), thư mục `src/` (loại trừ `node_modules`, file `*.backupok.ts`).
**Started:** 2026-06-18

## Tóm tắt kiến trúc
- **Framework:** NestJS + Prisma (PostgreSQL, qua PgBouncer). ~22.6k LOC.
- **Modules chính:**
  - `auth` — JWT + Google OAuth, bcrypt password (có fallback plain-text legacy).
  - `users` — CRUD nhân sự, phân quyền theo role, đồng bộ chéo sang các bảng Lark.
  - `social-publishing` — đăng bài đa nền tảng (FB/IG/TikTok/Threads/YouTube/Zalo): `accounts` (token mã hoá AES-256-GCM), `oauth` (state HMAC), `queue` + `schedule` (worker cron mỗi 5s, claim job qua `next_retry_at`), `publish` (transcode ffmpeg, tải Drive về local), `upload` (Google Drive storage).
  - `lark-sync` — đồng bộ Bitable Lark ↔ DB (file `lark.service.ts` 7700 dòng), tạo remote PrismaClient theo URL.
  - `common` — `cache` (Redis + fallback in-memory, dedup thundering-herd), guards/pipes/filters.
- **Luồng đăng bài:** client → `publish`/`queue` enqueue `SocialPost` (PENDING) → cron `ScheduleService.checkAndExecute` claim theo concurrency → `PublishService.executeScheduled` → platform publisher → cập nhật status.

## Bảng bug

| ID | File:dòng | Mức độ | Mô tả | Cách sửa đề xuất | Trạng thái |
|----|-----------|--------|-------|------------------|------------|
| BUG-01 | [users.service.ts:230](src/modules/users/users.service.ts#L230) | **High** | `update()` build object `updateData` đã được làm sạch (hash password → `password_hash`, map `avatar`→`image_url`, convert `role`→`roles`, xoá field không phải cột Prisma) nhưng transaction lại spread `...updateUserDto` thô. `UpdateUserDto` chứa `password` và `role` (không phải cột của model `User`) → Prisma ném `Unknown argument`. Hệ quả: mọi lần cập nhật user có đổi mật khẩu hoặc dùng `role` legacy sẽ **crash**; đổi mật khẩu không bao giờ được hash/áp dụng; `updateData` trở thành dead code. | Dùng `...updateData` thay cho `...updateUserDto` trong `tx.user.update`. | ✅ Fixed |
| BUG-02 | [accounts.service.ts:103](src/modules/social-publishing/accounts/accounts.service.ts#L103) | ~~Medium~~ | ~~`saveAccount()` luôn set `is_shared: data.isShared ?? true` kể cả ở nhánh UPDATE → re-save bật lại chia sẻ.~~ **KHÔNG PHẢI BUG — chủ ý** (xác nhận từ chủ dự án 2026-06-18): account mặc định chia sẻ cho toàn hệ thống; re-save bật lại `true` là hành vi mong muốn. Đã hoàn tác thay đổi, thêm comment giải thích + test khoá hành vi. | (không sửa) | ✅ By design |
| BUG-03 | [roles.guard.ts:20-21](src/common/guards/roles.guard.ts#L20-L21) | **Low** | `const { user } = request; return requiredRoles.some(r => user.roles?.includes(r))`. Nếu `user` là `undefined` (route gắn `@Roles` nhưng thiếu/đặt sai thứ tự `JwtAuthGuard`, hoặc request chưa auth) → `user.roles` ném `TypeError` → trả 500 thay vì 403. | Thêm `if (!user) return false;` trước khi truy cập `user.roles`. | ✅ Fixed |
| BUG-04 | [http-exception.filter.ts:1](src/common/filters/http-exception.filter.ts) | **Low** | File rỗng (0 byte), không được import/đăng ký ở đâu (grep `HttpExceptionFilter` = 0 match). Dead/incomplete code — không ảnh hưởng runtime. | Để nguyên (không over-scope) hoặc xoá file chết. Không sửa trong vòng này. | ⏸️ Won't-fix (no runtime impact) |
| BUG-05 | [schedule.service.ts:178-185](src/modules/social-publishing/schedule/schedule.service.ts#L178-L185) | **Medium** | `next_retry_at` vừa là cờ "đã claim/đang xử lý" (now+40m) vừa là mốc backoff retry (now+5m/15m). Query đếm in-flight (`next_retry_at > now && <= now+40m`) gộp luôn job đang chờ retry (5m/15m < 40m) thành "đang xử lý" → chiếm slot concurrency. Nhiều job fail đang chờ retry có thể lấp đầy `GLOBAL_CONCURRENCY=15`/limit từng platform và **chặn job mới**. | Cần tách trạng thái claimed vs retry-pending (thêm cột `claimed_until`/`processing`). Cần migration schema → ngoài phạm vi fix tĩnh vòng này. | ⏸️ Won't-fix (cần migration, out of scope) |
| BUG-06 | [videos.service.ts:102](src/modules/videos/videos.service.ts#L102) | **Medium** | `saveFile()` tạo path bằng `${Date.now()}_${file.originalname}` rồi `path.join(uploadDir, filename)`. `file.originalname` do client cung cấp (FileInterceptor mặc định không sanitize) → tên dạng `x/../../../tmp/evil.sh` cho phép ghi file **ra ngoài thư mục upload** (path traversal, ghi đè file tuỳ ý — chỉ cần 1 user đã đăng nhập). | Dùng `path.basename(file.originalname)` để loại bỏ thành phần thư mục trước khi ghép path. | ✅ Fixed |
| BUG-07 | [videos.service.ts:264](src/modules/videos/videos.service.ts#L264) | **Low** | `checkDuplicate()` tính `existingVideosData` (kèm self-heal duration ghi DB) nhưng gửi lên AI service `existing_videos: JSON.stringify([])` (mảng rỗng) → biến `existingVideosData` không bao giờ được dùng để so sánh. Có thể là chủ ý (AI service tự quét `channel_scan`), nhưng là dead computation gây nhầm lẫn. | Cần xác nhận với chủ dự án xem có chủ ý dùng `channel_scan` không. Không sửa (rủi ro thay đổi hành vi nghiệp vụ). | ⏸️ Won't-fix (cần xác nhận intent) |

## Nhật ký vòng lặp
- **Vòng 1:** tìm thấy 5 bug, đã fix 3 (BUG-01/02/03), còn lại 2 (BUG-04/05 → won't-fix có lý do). Đã thêm 3 file test (`roles.guard.spec.ts`, `users.service.spec.ts`, `accounts.service.spec.ts`) — 9/9 test pass. `tsc --noEmit` exit 0.
- **Vòng 2 (re-review):** tìm thấy 1 bug mới (BUG-06 path traversal trong upload video), đã fix; rà thêm videos/history/drafts/role-permissions/collection/media → các module này sạch. Xác nhận BUG-01/02/03 không gây regression. `tsc` exit 0, 9/9 test pass. → Tổng vòng 2: tìm 1, fix 1.
- **Vòng 3 (review xác nhận):** quét lại các fix + module phụ cận; `media.controller` đã dùng `path.basename` an toàn (chỉ `videos.service` thiếu — đã vá). Không phát hiện bug mới có thể fix. `tsc` exit 0, 9/9 test pass. → **Một vòng review đầy đủ không tìm thấy bug mới → DỪNG.**

### Kết quả cuối (đã cập nhật sau phản hồi chủ dự án)
- Tổng mục: **7**. Đã fix: **3** (BUG-01 High, BUG-03 Low, BUG-06 Medium). By design (không phải bug): **1** (BUG-02 — chia sẻ account toàn hệ thống là chủ ý). Won't-fix có lý do: **3** (BUG-04 dead file; BUG-05 cần migration schema; BUG-07 cần xác nhận intent nghiệp vụ).
- Test thêm: 3 file spec, 9 test — tất cả pass. Type-check toàn backend: pass.
- **Lưu ý cho chủ dự án:** BUG-05 (kẹt hàng chờ khi nhiều job retry) và BUG-07 (so trùng video bỏ qua video nội bộ) nên được xử lý ở PR riêng vì cần đổi schema / xác nhận yêu cầu.
