CREATE TABLE "performance_kpi_groups" (
    "id" UUID NOT NULL,
    "team_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'SLATE',
    "icon" TEXT NOT NULL DEFAULT 'TARGET',
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "performance_kpi_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "performance_kpi_groups_code_key" ON "performance_kpi_groups"("code");
CREATE INDEX "performance_kpi_groups_team_id_is_active_sort_order_idx"
    ON "performance_kpi_groups"("team_id", "is_active", "sort_order");

ALTER TABLE "performance_kpi_groups"
    ADD CONSTRAINT "performance_kpi_groups_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_kpi_groups"
    ADD CONSTRAINT "performance_kpi_groups_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "performance_kpi_groups"
    ("id", "code", "name", "description", "color", "icon", "sort_order", "is_system")
VALUES
    ('10000000-0000-4000-8000-000000000001', 'VIDEO_PRODUCTION', 'Số video sản xuất đạt tiêu chuẩn', 'Nhóm KPI cố định về sản lượng video và phân bổ tuyến nội dung', 'ORANGE', 'VIDEO', 10, true),
    ('10000000-0000-4000-8000-000000000002', 'CONTENT', 'Content', 'Nhóm KPI cố định về sáng tạo và phân tích content', 'GREEN', 'FILE_TEXT', 20, true),
    ('10000000-0000-4000-8000-000000000003', 'PRODUCT', 'Product', 'Nhóm KPI cố định về sản phẩm', 'PURPLE', 'PACKAGE', 30, true),
    ('10000000-0000-4000-8000-000000000004', 'LEGACY_FLEXIBLE', 'KPI bổ sung', 'Nhóm tương thích cho KPI linh hoạt đã tạo trước khi có phân nhóm', 'BLUE', 'TARGET', 90, true);

ALTER TABLE "performance_goals" ADD COLUMN "kpi_group_id" UUID;

-- Không xóa/chuyển nghĩa dữ liệu cũ: mọi KPI cũ được đưa vào nhóm tương thích; OKR để riêng.
UPDATE "performance_goals"
SET "kpi_group_id" = '10000000-0000-4000-8000-000000000004'
WHERE "type" = 'KPI' AND "kpi_group_id" IS NULL;

CREATE INDEX "performance_goals_kpi_group_id_month_status_idx"
    ON "performance_goals"("kpi_group_id", "month", "status");
ALTER TABLE "performance_goals"
    ADD CONSTRAINT "performance_goals_kpi_group_id_fkey"
    FOREIGN KEY ("kpi_group_id") REFERENCES "performance_kpi_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
