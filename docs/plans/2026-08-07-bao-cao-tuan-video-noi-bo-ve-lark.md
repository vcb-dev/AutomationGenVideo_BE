# Báo cáo hiệu suất 7 ngày video kênh nội bộ về Lark — Kế hoạch thi công

**Mục tiêu:** Mỗi ngày 09:00 giờ VN, video kênh nội bộ đăng đủ 7 ngày được chốt số liệu
(view/like/comment/share) và gửi một tin tổng hợp về Lark.

**Phạm vi v1:** một người nhận duy nhất, đọc từ `LARK_NOTIFY_OPEN_ID`. Nhắn riêng cho từng chủ
kênh là v2 — **chưa làm**, xem mục "Rào chắn cho v2" cuối file.

**Kiến trúc:** Cron 09:00 chọn video có `published_at` trong `[now-14d, now-7d)` và chưa có bản ghi
chốt trong `owned_video_weekly_notify_log`, **làm mới chỉ số cho đúng lô đó**, gom số liệu theo
fanpage, dựng một tin text, gửi qua app Lark riêng (`LARK_NOTIFY_APP_ID`), ghi log từng `post_id`.
Chọn mốc theo **ngày đăng** chứ không phải ngày cào, để mọi video được đo cùng độ dài vòng đời.

**Tech:** NestJS + Prisma (BE) · Lark OpenAPI (`im/v1/messages`)

---

## Ràng buộc chung

- **KHÔNG** `prisma db push`. Đổi schema phải viết migration tay trong
  `prisma/migrations/<timestamp>_<ten>/migration.sql`.
- `node` không có trong PATH: mọi lệnh dùng `PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`.
- Mỗi chức năng **một file test riêng** trong `src/modules/<module>/__tests__/`. CI chặn cứng.
- Chú thích giải thích **vì sao** kèm số đo thật; đặt tên tiếng Việt ở tầng nghiệp vụ.
- Dùng app Lark **riêng** (`LARK_NOTIFY_*`), tuyệt đối không đụng `LARK_APP_ID` — app đó đang gánh
  đồng bộ KPI, checklist, nhân sự.

---

## Sự thật đã đo (06–07/08/2026)

| Việc | Số đo |
|---|---|
| Fanpage nội bộ đang bật | 95 — cả 95 đều có `page_access_token` |
| Video tròn 7 ngày mỗi ngày | 112–168 (đo 5 ngày liên tiếp) |
| Tổng kho video nội bộ | 20.515, cũ nhất 11/02/2022 |
| Cron làm mới chỉ số | 12:00, `refreshRecentMetrics(7)`, lọc `published_at >= now() - 7 ngày` |
| Nối fanpage → chủ qua `huyk_channels` (tên chuẩn hoá) | 37 khớp, nhưng chỉ **23** ra đúng một chủ |
| Nối fanpage → chủ qua bảng Lark `DANH SÁCH NV CẦM KÊNH` | 47 dòng Facebook, chỉ **9** ra đúng một người |
| Nối theo `page_id` ↔ `channel_id` / `link_channel` | **0** — hai hệ không dùng chung định danh |
| `users.employee_data` làm nguồn `open_id` | **Không dùng được** — `ou_2c3af09a…` gán cho cả `Trần Uyển Nhi` lẫn `Lệnh Ngọc Khánh`; 17/65 người lệch tên Lark ↔ `full_name` |
| Tra `open_id` bằng `emails` | Rỗng 100% (4/4 email thật) — tài khoản Lark đăng ký bằng **số điện thoại** |
| Tra `open_id` bằng `mobiles` | Chạy — `+84388695140` → `ou_031c11b12ded5986e1c271f5d031ac42` |
| App cũ `LARK_APP_ID` gửi tin | Chặn `230013 Bot has NO availability to this user` |
| App mới `message VCBI` | Đã phát hành, Availability = All, **gửi thật thành công** (`message_id=om_x100b68…`) |

**Kết luận rút ra:** không nguồn dữ liệu nào biết được fanpage nào của ai (tốt nhất 23/95). Đó là
dữ liệu chưa từng tồn tại, không phải chưa tìm ra. Vì vậy v1 gửi cho một người, không định tuyến.

---

## Task 1 — BE: bảng nhật ký gửi

**Files:** `prisma/schema.prisma`, `prisma/migrations/<timestamp>_owned_video_weekly_notify_log/migration.sql`

**Produces:** bảng `owned_video_weekly_notify_log`

- [ ] Model Prisma: `id`, `post_id` (**unique**), `lark_open_id`, `sent_at`, `trang_thai`,
      `so_lan_thu` (mặc định 0), `loi` (nullable). Index trên `trang_thai`.
- [ ] Viết migration SQL tay. **Không** `prisma db push`.
- [ ] `trang_thai` ba giá trị: `da_gui` · `khong_co_nguoi_nhan` · `loi`.
      Hai giá trị đầu là chốt (không thử lại), `loi` thử lại tối đa 3 lượt.
- [ ] Kiểm chứng: `npx prisma migrate status` sạch, `\d owned_video_weekly_notify_log` đúng cột.

## Task 2 — BE: LarkNotifyService

**Files:** `src/modules/lark-sync/lark-notify.service.ts`, `lark.module.ts`

**Produces:** `guiTinNhan(openId: string, noiDung: string): Promise<{ messageId: string }>`

- [ ] File **riêng**, không thêm vào `lark.service.ts` — file đó đã 4.972 dòng và việc gửi tin
      không dính gì tới Bitable.
- [ ] Tự lấy `tenant_access_token` từ `LARK_NOTIFY_APP_ID` / `LARK_NOTIFY_APP_SECRET`, cache theo
      `expire` trả về.
- [ ] Phân loại lỗi: `99992351` (open_id sai) và `230013` (ngoài phạm vi bot) là **lỗi chết** —
      ném lỗi có cờ `vinhVien: true`. Lỗi mạng/5xx là lỗi tạm, cho thử lại.
- [ ] **Test:** `src/modules/lark-sync/__tests__/lark-notify-phan-loai-loi.spec.ts` — giả lập từng
      mã lỗi, khẳng định cờ `vinhVien` đúng.

## Task 3 — BE: chọn video tròn tuần

**Files:** `src/modules/owned-video-weekly-report/bao-cao-tuan.service.ts` (mới)

**Produces:** `layVideoTronTuan(): Promise<VideoTronTuan[]>`

- [ ] Truy vấn: `published_at` trong `[now-14d, now-7d)`, `mp.is_active`, và **chưa** có bản ghi
      chốt trong log (`da_gui` / `khong_co_nguoi_nhan` / `loi` với `so_lan_thu >= 3`).
- [ ] Chú thích rõ vì sao chặn 14 ngày: kho có 20.515 video từ 2022, bỏ chặn thì lần chạy đầu
      bắn ngược toàn bộ.
- [ ] **Test:** `__tests__/chon-video-tron-tuan.spec.ts` — video 6 ngày bị loại, 7 ngày được chọn,
      15 ngày bị loại, video đã `da_gui` bị loại, video `loi` 2 lượt vẫn được chọn lại.

## Task 4 — BE: dựng nội dung tin

**Files:** `src/modules/owned-video-weekly-report/dung-noi-dung-tin.ts` (mới, hàm thuần)

**Produces:** `dungNoiDungTin(videos: VideoTronTuan[]): string`

- [ ] Tách thành hàm **thuần**, không đụng Prisma — để test không cần DB và để đổi sang thẻ
      tương tác Lark sau này không phải sờ vào phần khác.
- [ ] Bố cục: dòng tổng (số video · tổng view · tổng like) → top 10 video xem nhiều nhất →
      danh sách fanpage yếu nhất. Không liệt kê hết 128 video, không ai đọc nổi.
- [ ] Số lớn rút gọn kiểu Việt (`1,24M`, `34,2K`).
- [ ] **Test:** `__tests__/dung-noi-dung-tin.spec.ts` — danh sách rỗng, đúng 1 video, 200 video
      (khẳng định chỉ ra 10 dòng top), định dạng số.

## Task 5 — BE: điều phối gửi + ghi log

**Files:** `bao-cao-tuan.service.ts`, `owned-video-weekly-report.module.ts` (mới)

**Produces:** `chay(cheDoKho: boolean): Promise<KetQuaChay>`

- [ ] Thứ tự: chọn video (Task 3) → làm mới chỉ số lô đó (Task 7) → dựng tin (Task 4) → gửi → ghi log.
- [ ] `cheDoKho = true`: có làm mới chỉ số, dựng tin và trả về, nhưng **không** gửi, **không** ghi log.
- [ ] Người nhận đọc từ `LARK_NOTIFY_OPEN_ID`. Thiếu biến này thì ghi
      `khong_co_nguoi_nhan` cho toàn bộ và log cảnh báo, không ném lỗi làm chết cron.
- [ ] Trần an toàn mỗi lượt: tối đa 50 tin, chặn lỗi dây chuyền thành trận spam.
- [ ] **Test:** `__tests__/dieu-phoi-gui-bao-cao.spec.ts` — chế độ khô không gọi `guiTinNhan`;
      lỗi vĩnh viễn ghi chốt không thử lại; lỗi tạm tăng `so_lan_thu`.

## Task 6 — BE: endpoint chạy tay

**Files:** `bao-cao-tuan.controller.ts` (mới)

**Produces:** `POST /api/bao-cao-tuan/chay-thu` · `POST /api/bao-cao-tuan/gui-ngay`

- [ ] `chay-thu` trả về nội dung tin dạng text để đọc trước khi gửi thật.
- [ ] Cả hai endpoint đặt sau guard xác thực như các controller khác trong repo.
- [ ] Kiểm chứng: `curl` `chay-thu` với token thật, đọc nội dung trả về, đối chiếu số liệu với
      một truy vấn SQL độc lập.

## Task 7 — BE: làm mới chỉ số cho đúng lô sắp gửi

**Files:** `bao-cao-tuan.service.ts`

**Produces:** `lamMoiChiSoLoNay(videos: VideoTronTuan[]): Promise<void>`

- [ ] Gom lô theo fanpage, mỗi fanpage gọi `FacebookAiClientService.fetchMetricsRefresh(token, postIds)`
      rồi ghi lại `view_count` / `like_count` / `comment_count` / `share_count`.
- [ ] Chú thích lý do tồn tại: cron làm mới toàn cục chạy **12:00**, mà báo cáo chạy **09:00** —
      không làm mới riêng thì số gửi đi là số của 12:00 hôm qua, cũ ~21 tiếng. Lô này chỉ ~130
      video (so với ~1.300 của cả cửa sổ 7 ngày) nên rẻ hơn nhiều lần việc nới cửa sổ toàn cục.
      Sau hôm nay video rớt khỏi cửa sổ 7 ngày và không bao giờ được làm mới nữa — nên đây đúng là
      con số chốt cuối cùng hệ thống có.
- [ ] Fanpage không có token hoặc Graph API lỗi: bỏ qua, dùng số cũ trong DB, **không** làm hỏng
      cả lượt chạy. Ghi log cảnh báo.
- [ ] **KHÔNG** đụng `refreshRecentMetrics` hay cron 12:00 — giữ nguyên phần đang chạy.
- [ ] **Test:** `__tests__/lam-moi-chi-so-lo.spec.ts` — gom đúng theo fanpage; fanpage thiếu token
      bị bỏ qua mà lô vẫn chạy tiếp; lỗi Graph API không ném ra ngoài.

## Task 8 — BE: cron 09:00

**Files:** `bao-cao-tuan.cron.service.ts` (mới), `owned-video-weekly-report.module.ts`

- [ ] `@Cron('0 0 9 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })`, cờ `dangChay` chống chồng lượt
      (theo mẫu `OwnedPaastCronService`).
- [ ] Giờ 09:00 không đụng cron nào sẵn có: 05:30 token · 06:00 import · 06:30 backfill ·
      07:00 delta sync · 07:30 chấm PAAST (~12 phút) · 12:00 làm mới chỉ số.
- [ ] **Để tắt** bằng biến môi trường `BAO_CAO_TUAN_BAT=false` cho tới khi nội dung tin được duyệt.
- [ ] Kiểm chứng: chạy `gui-ngay` thật một lần, đọc tin trong Lark, kiểm bảng log có đúng số dòng.

---

## Rào chắn cho v2 (nhắn riêng từng chủ kênh)

Ghi lại để không phải dò lại từ đầu:

1. **Chưa ai biết fanpage nào của ai.** Nguồn tốt nhất phủ 23/95. Phải thêm cột trên bảng fanpage
   và có người ngồi gán một lần. Nên lưu thẳng `lark_open_id`, **không** lưu `owner_id` trỏ
   `users` rồi ghép sang Lark — lớp ghép đó chính là chỗ đã tạo ra lỗi `Trần Uyển Nhi` /
   `Lệnh Ngọc Khánh`.
2. **App `message VCBI` không dùng được cho v2.** Tài khoản tạo app thuộc workspace `VCBTec`,
   còn đồng nghiệp là liên hệ **ngoài tổ chức** — bot Lark không nhắn riêng người ngoài tổ chức.
   v2 cần app đặt trong tenant công ty, hoặc mở `Availability` cho app `VCB BOT` sẵn có.
3. **Tra người phải bằng số điện thoại**, không phải email. Bảng `users` hiện **không có cột nào
   chứa số điện thoại** — đây là việc phải giải trước khi làm v2.
