-- =============================================================================
-- Gộp 3 migration thủ công của module task-auto để chạy 1 lần khi mang sang môi
-- trường khác. Nguồn gốc từng phần vẫn giữ nguyên ở các file riêng lẻ:
--   - manual_product_content_classification.sql
--   - manual_task_auto_cooldown_target_quantity.sql
--   - manual_add_missing_task_auto_indexes.sql
-- Applied via `prisma db execute` (không dùng `prisma migrate dev` — DB đã lệch quá
-- nhiều so với schema.prisma nên shadow-db replay fail).
--
-- ⚠️ QUAN TRỌNG: Phần 3 (CREATE INDEX CONCURRENTLY) KHÔNG thể chạy trong 1
-- transaction. Nếu công cụ bạn dùng tự động bọc cả file trong BEGIN...COMMIT
-- (kể cả `prisma db execute --file`), phần 3 sẽ lỗi "CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block". Khi đó hãy tách phần 3 ra chạy riêng
-- (VD: `psql -f`, hoặc từng câu một qua `$executeRawUnsafe`) sau khi Phần 1+2
-- đã áp dụng xong. Phần 1+2 chạy trong transaction bình thường không sao.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PHẦN 1: Phân loại nghiệp vụ cho sản phẩm (Main/Test/Đẩy...) và content
-- (Content Win/Test...) do người dùng tự thêm/xóa — khác với Content.status
-- (ContentUsageStatus, trạng thái vòng đời task) và Product.is_active (bật/tắt
-- sản phẩm).
-- ─────────────────────────────────────────────────────────────────────────────

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


-- ─────────────────────────────────────────────────────────────────────────────
-- PHẦN 2: Cooldown riêng theo sản phẩm (override AutoAssignSetting.default_cooldown_days)
-- và target_quantity cụ thể theo tháng cho warehouse — dùng cho logic tự động
-- chia lại task khi sản phẩm đang trong thời gian chờ (cooldown).
-- ─────────────────────────────────────────────────────────────────────────────

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


-- ─────────────────────────────────────────────────────────────────────────────
-- PHẦN 3: Index còn thiếu cho các bảng task-auto bị full table scan khi filter
-- theo cột phổ biến nhất (phát hiện khi audit hiệu năng CRUD task-auto).
-- ⚠️ Chạy CONCURRENTLY — xem cảnh báo transaction ở đầu file.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS "editor_contents_user_id_idx"
  ON "editor_contents" ("user_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "editor_sources_user_id_idx"
  ON "editor_sources" ("user_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "tasks_team_id_status_idx"
  ON "tasks" ("team_id", "status");
