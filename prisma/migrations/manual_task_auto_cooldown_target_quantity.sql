-- Cooldown riêng theo sản phẩm (override AutoAssignSetting.default_cooldown_days) và
-- target_quantity cụ thể theo tháng cho warehouse — dùng cho logic tự động chia lại task
-- khi sản phẩm đang trong thời gian chờ (cooldown).
-- Applied via `prisma db execute` (không dùng `prisma migrate dev` — xem
-- manual_product_content_classification.sql để biết lý do).

-- AlterTable: products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cooldown_days" INTEGER;

-- AlterTable: team_products
ALTER TABLE "team_products" ADD COLUMN IF NOT EXISTS "cooldown_days" INTEGER;

-- AlterTable: editor_products
ALTER TABLE "editor_products" ADD COLUMN IF NOT EXISTS "cooldown_days" INTEGER;

-- AlterTable: auto_assign_settings
ALTER TABLE "auto_assign_settings" ADD COLUMN IF NOT EXISTS "default_cooldown_days" INTEGER NOT NULL DEFAULT 5;

-- AlterTable: team_product_warehouses
ALTER TABLE "team_product_warehouses" ADD COLUMN IF NOT EXISTS "target_quantity" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: editor_product_warehouses
ALTER TABLE "editor_product_warehouses" ADD COLUMN IF NOT EXISTS "target_quantity" INTEGER NOT NULL DEFAULT 1;
