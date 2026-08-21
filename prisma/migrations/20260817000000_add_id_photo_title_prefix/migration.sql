-- Thêm tiền tố chức danh in trước tên trên thẻ nhân viên (vd "HĐ." → "HĐ. BẢO VIỆT",
-- theo mẫu thẻ thật của công ty). Cột nullable, không có DEFAULT: các bản ghi cũ giữ NULL
-- và in ra thẻ y như trước, không cần backfill.
--
-- CHỈ ADD COLUMN trên đúng bảng id_photo_histories — không đụng cột/bảng nào khác.
-- IF NOT EXISTS để chạy lại nhiều lần không sập (cùng cách các migration idempotent khác
-- trong repo này, vd 20260805141500_add_lucky_spin).
ALTER TABLE "id_photo_histories" ADD COLUMN IF NOT EXISTS "employee_title_prefix" TEXT;
