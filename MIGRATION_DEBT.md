# BÁO CÁO NỢ KỸ THUẬT: LỖI HỆ THỐNG MIGRATION TRONG DỰ ÁN (PRISMA)

## ⚠️ Mô tả lỗi gặp phải
Khi cố gắng tạo migration mới bằng lệnh `npx prisma migrate dev`, hệ thống báo lỗi kẹt Shadow Database:
```
Error: P3006
Migration `20260318160000_sync_lark_traffic_columns` failed to apply cleanly to the shadow database. 
Error code: P1014
Error: The underlying table for model `lark_traffic` does not exist.
```

Sau khi thử tạo bảng `lark_traffic` giả lập ở mốc thời gian sớm nhất, hệ thống tiếp tục báo lỗi thiếu bảng tiếp theo:
```
Migration `20260626000000_add_warehouse_month` failed to apply cleanly to the shadow database. 
Error code: P1014
Error: The underlying table for model `contents` does not exist.
```

---

## 🔍 Nguyên nhân gốc rễ (Root Cause)
Thư mục lịch sử migrations (`prisma/migrations/`) hiện tại **bị phân mảnh và thiếu nghiêm trọng (corrupted)**:
1. Rất nhiều bảng cốt lõi của hệ thống (ví dụ: `contents`, `products`, `sources`, `editor_contents`, `team_contents`, `tasks`...) **chưa từng được định nghĩa lệnh `CREATE TABLE` trong bất kỳ file SQL migration nào**.
2. Các nhà phát triển trước đây có thể đã import dữ liệu trực tiếp bằng file dump SQL, chạy các câu lệnh DDL thủ công trực tiếp trên Database trực tiếp (dev/prod), hoặc lạm dụng lệnh `prisma db push` mà không tạo migration đồng hành.
3. Vì Shadow DB khi chạy `prisma migrate dev` sẽ dựng lại DB từ con số 0 dựa trên các file migration, việc thiếu các lệnh tạo bảng gốc khiến quá trình chạy tuần tự bị sập giữa chừng khi gặp các lệnh `ALTER TABLE` hoặc `ADD FOREIGN KEY` trỏ vào các bảng không tồn tại.

---

## 🛡️ Tác động (Impact)
* **Local Dev:** Không thể chạy `npx prisma migrate dev` để phát triển/thử nghiệm các tính năng liên quan đến thay đổi DB. Buộc phải lạm dụng `npx prisma db push` để đồng bộ trực tiếp.
* **Production / Staging Deploy:** Nếu hệ thống tự động CI/CD chạy lệnh `npx prisma migrate deploy` để cập nhật database, đợt deploy sẽ bị lỗi hoặc không tạo được các bảng mới (ví dụ như `characters`, `content_transform_histories` của tính năng content-transform) do thiếu file migration SQL tương ứng trong code repository.

---

## 🚀 Đề xuất giải pháp khắc phục (Tech Lead / DevOps)
Để khôi phục lại tính năng migration chuẩn hóa của Prisma, cần thực hiện **Baseline** lại toàn bộ lịch sử:

### Bước 1: Chuẩn bị ở Local
1. Tạm thời đổi tên thư mục `prisma/migrations/` hiện tại thành `prisma/migrations_backup/`.
2. Tạo một file migration gộp duy nhất thay thế từ trạng thái schema hiện tại:
   ```bash
   npx prisma migrate dev --name init --create-only
   ```
   Lệnh này sẽ tạo ra 1 file SQL duy nhất chứa toàn bộ lệnh `CREATE TABLE` cho toàn bộ các bảng trong file `schema.prisma`.
3. Di chuyển thư mục migration `init` mới này vào một chỗ an toàn, sau đó xóa bỏ thư mục backup `migrations_backup`.

### Bước 2: Đánh dấu đã áp dụng trên các Database hiện có (Dev / Staging / Production)
Vì trên các database này các bảng đã tồn tại và đang chứa dữ liệu thật, chạy lại file SQL gộp sẽ gây lỗi trùng lặp dữ liệu hoặc mất dữ liệu. Ta cần đánh dấu migration `init` là đã hoàn thành mà không thực thi SQL:
1. Đẩy code chứa thư mục migration `init` mới lên.
2. Chạy lệnh resolve trên từng database:
   ```bash
   npx prisma migrate resolve --applied init
   ```
3. Sau bước này, bảng `_prisma_migrations` của tất cả database sẽ đồng bộ với thư mục migrations trong code. Mọi đợt phát triển tiếp theo có thể tạo migration bình thường bằng lệnh `prisma migrate dev`.
