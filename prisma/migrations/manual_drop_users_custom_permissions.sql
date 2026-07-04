-- 2026-07-04: Bỏ tính năng "đặc quyền riêng" (custom_permissions) — trống 100% trên toàn bộ user,
-- chưa admin nào từng gán. Đã gỡ khỏi jwt.strategy, role-permissions, users module (BE)
-- và UI AccountManagement (FE). Quyền giờ tính hoàn toàn theo role_permissions.
ALTER TABLE "users" DROP COLUMN IF EXISTS "custom_permissions";
