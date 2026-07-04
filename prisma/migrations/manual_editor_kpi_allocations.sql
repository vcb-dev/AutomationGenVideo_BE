-- EditorKpi: thay ratio_a1..ratio_a5 / video_traffic / video_gmv / video_profit cố định
-- bằng bảng phân bổ động editor_kpi_allocations (mirror team_kpi_allocations), keyed theo
-- content_line_id/product_line_id thay vì a_type/video_category cố định.
-- Applied via `prisma db execute` (không dùng `prisma migrate dev` vì shadow DB replay bị lỗi
-- P3006 do drift lịch sử không liên quan — xem các file manual_*.sql khác trong thư mục này).

ALTER TABLE "editor_kpis" DROP COLUMN "ratio_a1",
DROP COLUMN "ratio_a2",
DROP COLUMN "ratio_a3",
DROP COLUMN "ratio_a4",
DROP COLUMN "ratio_a5",
DROP COLUMN "video_gmv",
DROP COLUMN "video_profit",
DROP COLUMN "video_traffic";

CREATE TABLE "editor_kpi_allocations" (
    "id" TEXT NOT NULL,
    "editor_kpi_id" TEXT NOT NULL,
    "type" "KpiAllocationType" NOT NULL,
    "content_line_id" TEXT,
    "product_line_id" TEXT,
    "percent" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "editor_kpi_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "editor_kpi_allocations_editor_kpi_id_idx" ON "editor_kpi_allocations"("editor_kpi_id");
CREATE INDEX "editor_kpi_allocations_content_line_id_idx" ON "editor_kpi_allocations"("content_line_id");
CREATE INDEX "editor_kpi_allocations_product_line_id_idx" ON "editor_kpi_allocations"("product_line_id");

ALTER TABLE "editor_kpi_allocations" ADD CONSTRAINT "editor_kpi_allocations_editor_kpi_id_fkey" FOREIGN KEY ("editor_kpi_id") REFERENCES "editor_kpis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "editor_kpi_allocations" ADD CONSTRAINT "editor_kpi_allocations_content_line_id_fkey" FOREIGN KEY ("content_line_id") REFERENCES "content_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "editor_kpi_allocations" ADD CONSTRAINT "editor_kpi_allocations_product_line_id_fkey" FOREIGN KEY ("product_line_id") REFERENCES "product_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
