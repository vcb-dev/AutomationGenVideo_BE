-- EditorKpiAllocation: chuyển percent (Float, %) sang quantity (Int, số video cụ thể).
-- Dữ liệu percent cũ không còn ý nghĩa dưới scheme mới nên xoá sạch, người dùng nhập lại.
-- Task: thêm product_line_id (denormalized như content_line_id) để auto-assign theo dõi
-- quota còn lại theo từng dòng sản phẩm trong tháng.
-- Applied via `prisma db execute` (không dùng `prisma migrate dev` — xem các file manual_*.sql khác).

DELETE FROM "editor_kpi_allocations";

ALTER TABLE "editor_kpi_allocations" RENAME COLUMN "percent" TO "quantity";
ALTER TABLE "editor_kpi_allocations" ALTER COLUMN "quantity" TYPE INTEGER USING "quantity"::INTEGER;

ALTER TABLE "tasks" ADD COLUMN "product_line_id" TEXT;
CREATE INDEX "tasks_content_line_id_idx" ON "tasks"("content_line_id");
CREATE INDEX "tasks_product_line_id_idx" ON "tasks"("product_line_id");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_product_line_id_fkey" FOREIGN KEY ("product_line_id") REFERENCES "product_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
