-- Phân loại nghiệp vụ cho sản phẩm (Main/Test/Đẩy...) và content (Content Win/Test...)
-- do người dùng tự thêm/xóa — khác với Content.status (ContentUsageStatus, trạng thái
-- vòng đời task) và Product.is_active (bật/tắt sản phẩm).
-- Applied via `prisma db execute` (không dùng `prisma migrate dev` — DB local đã lệch quá
-- nhiều so với schema.prisma nên shadow-db replay fail, xem các file manual_*.sql khác).

-- CreateTable
CREATE TABLE "product_classifications" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_classifications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_classifications_name_key" ON "product_classifications"("name");

-- CreateTable
CREATE TABLE "content_classifications" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_classifications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "content_classifications_name_key" ON "content_classifications"("name");

-- AlterTable: products
ALTER TABLE "products" ADD COLUMN "classification_id" TEXT;
CREATE INDEX "products_classification_id_idx" ON "products"("classification_id");
ALTER TABLE "products" ADD CONSTRAINT "products_classification_id_fkey"
  FOREIGN KEY ("classification_id") REFERENCES "product_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: team_products
ALTER TABLE "team_products" ADD COLUMN "classification_id" TEXT;
ALTER TABLE "team_products" ADD CONSTRAINT "team_products_classification_id_fkey"
  FOREIGN KEY ("classification_id") REFERENCES "product_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: editor_products
ALTER TABLE "editor_products" ADD COLUMN "classification_id" TEXT;
ALTER TABLE "editor_products" ADD CONSTRAINT "editor_products_classification_id_fkey"
  FOREIGN KEY ("classification_id") REFERENCES "product_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: contents
ALTER TABLE "contents" ADD COLUMN "classification_id" TEXT;
CREATE INDEX "contents_classification_id_idx" ON "contents"("classification_id");
ALTER TABLE "contents" ADD CONSTRAINT "contents_classification_id_fkey"
  FOREIGN KEY ("classification_id") REFERENCES "content_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: team_contents
ALTER TABLE "team_contents" ADD COLUMN "classification_id" TEXT;
ALTER TABLE "team_contents" ADD CONSTRAINT "team_contents_classification_id_fkey"
  FOREIGN KEY ("classification_id") REFERENCES "content_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: editor_contents
ALTER TABLE "editor_contents" ADD COLUMN "classification_id" TEXT;
ALTER TABLE "editor_contents" ADD CONSTRAINT "editor_contents_classification_id_fkey"
  FOREIGN KEY ("classification_id") REFERENCES "content_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
