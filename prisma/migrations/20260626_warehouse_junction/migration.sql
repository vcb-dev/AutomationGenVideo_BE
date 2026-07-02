-- Chuyển từ warehouse_month field sang junction tables
-- Cho phép một item thuộc nhiều kho tháng cùng lúc

-- Drop warehouse_month indexes
DROP INDEX IF EXISTS "products_warehouse_month_idx";
DROP INDEX IF EXISTS "contents_warehouse_month_idx";
DROP INDEX IF EXISTS "sources_warehouse_month_idx";
DROP INDEX IF EXISTS "team_products_team_id_warehouse_month_idx";
DROP INDEX IF EXISTS "team_contents_team_id_warehouse_month_idx";
DROP INDEX IF EXISTS "team_sources_team_id_warehouse_month_idx";
DROP INDEX IF EXISTS "editor_products_user_id_warehouse_month_idx";
DROP INDEX IF EXISTS "editor_contents_user_id_warehouse_month_idx";
DROP INDEX IF EXISTS "editor_sources_user_id_warehouse_month_idx";

-- Drop warehouse_month columns
ALTER TABLE "products"       DROP COLUMN IF EXISTS "warehouse_month";
ALTER TABLE "contents"       DROP COLUMN IF EXISTS "warehouse_month";
ALTER TABLE "sources"        DROP COLUMN IF EXISTS "warehouse_month";
ALTER TABLE "team_products"  DROP COLUMN IF EXISTS "warehouse_month";
ALTER TABLE "team_contents"  DROP COLUMN IF EXISTS "warehouse_month";
ALTER TABLE "team_sources"   DROP COLUMN IF EXISTS "warehouse_month";
ALTER TABLE "editor_products" DROP COLUMN IF EXISTS "warehouse_month";
ALTER TABLE "editor_contents" DROP COLUMN IF EXISTS "warehouse_month";
ALTER TABLE "editor_sources"  DROP COLUMN IF EXISTS "warehouse_month";

-- Create junction tables

CREATE TABLE "product_warehouses" (
  "product_id" TEXT NOT NULL,
  "month"      TEXT NOT NULL,
  CONSTRAINT "product_warehouses_pkey" PRIMARY KEY ("product_id", "month"),
  CONSTRAINT "product_warehouses_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE
);
CREATE INDEX "product_warehouses_month_idx" ON "product_warehouses"("month");

CREATE TABLE "content_warehouses" (
  "content_id" TEXT NOT NULL,
  "month"      TEXT NOT NULL,
  CONSTRAINT "content_warehouses_pkey" PRIMARY KEY ("content_id", "month"),
  CONSTRAINT "content_warehouses_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE
);
CREATE INDEX "content_warehouses_month_idx" ON "content_warehouses"("month");

CREATE TABLE "source_warehouses" (
  "source_id" TEXT NOT NULL,
  "month"     TEXT NOT NULL,
  CONSTRAINT "source_warehouses_pkey" PRIMARY KEY ("source_id", "month"),
  CONSTRAINT "source_warehouses_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE
);
CREATE INDEX "source_warehouses_month_idx" ON "source_warehouses"("month");

CREATE TABLE "team_product_warehouses" (
  "team_product_id" TEXT NOT NULL,
  "month"           TEXT NOT NULL,
  CONSTRAINT "team_product_warehouses_pkey" PRIMARY KEY ("team_product_id", "month"),
  CONSTRAINT "team_product_warehouses_team_product_id_fkey" FOREIGN KEY ("team_product_id") REFERENCES "team_products"("id") ON DELETE CASCADE
);
CREATE INDEX "team_product_warehouses_month_idx" ON "team_product_warehouses"("month");

CREATE TABLE "team_content_warehouses" (
  "team_content_id" TEXT NOT NULL,
  "month"           TEXT NOT NULL,
  CONSTRAINT "team_content_warehouses_pkey" PRIMARY KEY ("team_content_id", "month"),
  CONSTRAINT "team_content_warehouses_team_content_id_fkey" FOREIGN KEY ("team_content_id") REFERENCES "team_contents"("id") ON DELETE CASCADE
);
CREATE INDEX "team_content_warehouses_month_idx" ON "team_content_warehouses"("month");

CREATE TABLE "team_source_warehouses" (
  "team_source_id" TEXT NOT NULL,
  "month"          TEXT NOT NULL,
  CONSTRAINT "team_source_warehouses_pkey" PRIMARY KEY ("team_source_id", "month"),
  CONSTRAINT "team_source_warehouses_team_source_id_fkey" FOREIGN KEY ("team_source_id") REFERENCES "team_sources"("id") ON DELETE CASCADE
);
CREATE INDEX "team_source_warehouses_month_idx" ON "team_source_warehouses"("month");

CREATE TABLE "editor_product_warehouses" (
  "editor_product_id" TEXT NOT NULL,
  "month"             TEXT NOT NULL,
  CONSTRAINT "editor_product_warehouses_pkey" PRIMARY KEY ("editor_product_id", "month"),
  CONSTRAINT "editor_product_warehouses_editor_product_id_fkey" FOREIGN KEY ("editor_product_id") REFERENCES "editor_products"("id") ON DELETE CASCADE
);
CREATE INDEX "editor_product_warehouses_month_idx" ON "editor_product_warehouses"("month");

CREATE TABLE "editor_content_warehouses" (
  "editor_content_id" TEXT NOT NULL,
  "month"             TEXT NOT NULL,
  CONSTRAINT "editor_content_warehouses_pkey" PRIMARY KEY ("editor_content_id", "month"),
  CONSTRAINT "editor_content_warehouses_editor_content_id_fkey" FOREIGN KEY ("editor_content_id") REFERENCES "editor_contents"("id") ON DELETE CASCADE
);
CREATE INDEX "editor_content_warehouses_month_idx" ON "editor_content_warehouses"("month");

CREATE TABLE "editor_source_warehouses" (
  "editor_source_id" TEXT NOT NULL,
  "month"            TEXT NOT NULL,
  CONSTRAINT "editor_source_warehouses_pkey" PRIMARY KEY ("editor_source_id", "month"),
  CONSTRAINT "editor_source_warehouses_editor_source_id_fkey" FOREIGN KEY ("editor_source_id") REFERENCES "editor_sources"("id") ON DELETE CASCADE
);
CREATE INDEX "editor_source_warehouses_month_idx" ON "editor_source_warehouses"("month");
