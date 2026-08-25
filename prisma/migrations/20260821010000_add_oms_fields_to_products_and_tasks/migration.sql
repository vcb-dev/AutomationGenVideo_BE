-- Tích hợp OMS (warehouse-be) làm nguồn dữ liệu sản phẩm cho kho tổng & kho team.

-- team_products: leader "kéo" sản phẩm OMS về kho team, oms_variant_id unique theo team để
-- tránh kéo trùng cùng 1 SKU.
ALTER TABLE "team_products" ADD COLUMN IF NOT EXISTS "oms_product_id" TEXT;
ALTER TABLE "team_products" ADD COLUMN IF NOT EXISTS "oms_variant_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "team_products_team_id_oms_variant_id_key"
    ON "team_products"("team_id", "oms_variant_id");

-- editor_products: hệ thống tự materialize khi giao task chọn sản phẩm trực tiếp từ kho tổng
-- (OMS), oms_variant_id unique theo user để tránh tạo trùng.
ALTER TABLE "editor_products" ADD COLUMN IF NOT EXISTS "oms_product_id" TEXT;
ALTER TABLE "editor_products" ADD COLUMN IF NOT EXISTS "oms_variant_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "editor_products_user_id_oms_variant_id_key"
    ON "editor_products"("user_id", "oms_variant_id");

-- tasks: tạm giữ oms_product_id/oms_variant_id khi task tạo PENDING (chưa có assignee) và chọn
-- sản phẩm trực tiếp từ kho tổng (OMS) — materialize thành editor_product_id lúc gán assignee.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "oms_product_id" TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "oms_variant_id" TEXT;
