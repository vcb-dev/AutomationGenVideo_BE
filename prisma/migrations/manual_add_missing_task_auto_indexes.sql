-- Thêm index còn thiếu cho các bảng task-auto bị full table scan khi filter theo cột phổ biến nhất
-- (phát hiện khi audit hiệu năng CRUD task-auto — xem schema.prisma cho @@index tương ứng).
-- Applied via `prisma db execute` (không dùng `prisma migrate dev` — xem các file manual_*.sql khác).
--
-- Dùng CONCURRENTLY để không khoá bảng khi tạo index trên DB production đang có traffic.
-- LƯU Ý: CREATE INDEX CONCURRENTLY không thể chạy trong 1 transaction — nếu áp dụng qua công cụ
-- nào đó tự động bọc transaction, hãy chạy từng câu lệnh riêng lẻ (VD: psql -f, hoặc
-- `prisma db execute --file <path> --schema prisma/schema.prisma`).

CREATE INDEX CONCURRENTLY IF NOT EXISTS "editor_contents_user_id_idx"
  ON "editor_contents" ("user_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "editor_sources_user_id_idx"
  ON "editor_sources" ("user_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "tasks_team_id_status_idx"
  ON "tasks" ("team_id", "status");
