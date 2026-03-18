-- Đảm bảo cột khớp schema Prisma (idempotent).
-- Chạy khi DB thiếu cột dù đã migrate, hoặc sau khi restore DB cũ.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lark_employee_record_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "image_url" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_data" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_position" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_status" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_date" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "users_lark_employee_record_id_key" ON "users"("lark_employee_record_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_employee_id_key" ON "users"("employee_id");
