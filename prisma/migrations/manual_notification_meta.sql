-- Task: thêm cột meta (JSONB) cho notifications — lưu payload có cấu trúc cho các loại
-- thông báo cần render chi tiết ở FE (vd AUTO_ASSIGN_EMPTY_WAREHOUSE: số video cần làm hôm nay,
-- tình trạng KPI đẩy sản phẩm, breakdown theo tuyến nội dung).
-- Applied via `prisma db execute` (không dùng `prisma migrate dev` — xem các file manual_*.sql khác).

ALTER TABLE "notifications" ADD COLUMN "meta" JSONB;
