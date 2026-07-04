-- AlterTable: thêm cột warehouse_month (kho tháng) vào 9 bảng danh mục
-- NULL = không thuộc tháng cụ thể (backward compat), "yyyy-MM" = thuộc kho tháng đó

ALTER TABLE "contents" ADD COLUMN "warehouse_month" TEXT;
ALTER TABLE "editor_contents" ADD COLUMN "warehouse_month" TEXT;
ALTER TABLE "editor_products" ADD COLUMN "warehouse_month" TEXT;
ALTER TABLE "editor_sources" ADD COLUMN "warehouse_month" TEXT;
ALTER TABLE "products" ADD COLUMN "warehouse_month" TEXT;
ALTER TABLE "sources" ADD COLUMN "warehouse_month" TEXT;
ALTER TABLE "team_contents" ADD COLUMN "warehouse_month" TEXT;
ALTER TABLE "team_products" ADD COLUMN "warehouse_month" TEXT;
ALTER TABLE "team_sources" ADD COLUMN "warehouse_month" TEXT;

-- CreateIndex: index để query nhanh theo warehouse_month

CREATE INDEX "contents_warehouse_month_idx" ON "contents"("warehouse_month");
CREATE INDEX "editor_contents_user_id_warehouse_month_idx" ON "editor_contents"("user_id", "warehouse_month");
CREATE INDEX "editor_products_user_id_warehouse_month_idx" ON "editor_products"("user_id", "warehouse_month");
CREATE INDEX "editor_sources_user_id_warehouse_month_idx" ON "editor_sources"("user_id", "warehouse_month");
CREATE INDEX "products_warehouse_month_idx" ON "products"("warehouse_month");
CREATE INDEX "sources_warehouse_month_idx" ON "sources"("warehouse_month");
CREATE INDEX "team_contents_team_id_warehouse_month_idx" ON "team_contents"("team_id", "warehouse_month");
CREATE INDEX "team_products_team_id_warehouse_month_idx" ON "team_products"("team_id", "warehouse_month");
CREATE INDEX "team_sources_team_id_warehouse_month_idx" ON "team_sources"("team_id", "warehouse_month");
