-- ĐÃ THAY THẾ (2026-08-05) bởi 20260805141500_add_lucky_spin/migration.sql — đừng chạy file này nữa.

-- Khóa điều khiển vòng quay: một người điều khiển, những người khác chỉ xem.
-- Viết tay (không dùng prisma db push — xem MIGRATION_DEBT.md và ghi chú trong
-- manual_add_lucky_spin.sql: db push sẽ xoá ~60 bảng đang có dữ liệu thật).

ALTER TABLE "spin_workspaces" ADD COLUMN IF NOT EXISTS "controller_id" UUID;
ALTER TABLE "spin_workspaces" ADD COLUMN IF NOT EXISTS "controller_name" TEXT;
ALTER TABLE "spin_workspaces" ADD COLUMN IF NOT EXISTS "control_expires_at" TIMESTAMP(3);
