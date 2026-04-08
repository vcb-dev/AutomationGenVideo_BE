-- CreateTable
CREATE TABLE "lark_kpi_do_da" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT,
    "name" TEXT,
    "tag" TEXT,
    "team" TEXT,
    "image_url" TEXT,
    "kpi_day" INTEGER,
    "kpi_month" INTEGER,
    "kpii_status" TEXT,
    "kpi_day_percent" TEXT,
    "completed_day" INTEGER,
    "completed_month" INTEGER,
    "task_new" INTEGER,
    "task_new_month" INTEGER,
    "task_auto" INTEGER,
    "task_auto_month" INTEGER,
    "task_creative" INTEGER,
    "content_win_new" INTEGER,
    "revenue_month" BIGINT,
    "traffic_month" BIGINT,
    "target_revenue_month" TEXT,
    "target_traffic_month" TEXT,
    "kpi_progress_month" DOUBLE PRECISION,
    "employee_status" TEXT,
    "state" TEXT,
    "employee_data" JSONB,
    "report_date" TIMESTAMP(3),
    "month" TEXT,
    "link_image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_kpi_do_da_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lark_kpi_do_da_month_idx" ON "lark_kpi_do_da"("month");
CREATE INDEX "lark_kpi_do_da_report_date_team_idx" ON "lark_kpi_do_da"("report_date", "team");
CREATE INDEX "lark_kpi_do_da_team_idx" ON "lark_kpi_do_da"("team");
CREATE INDEX "lark_kpi_do_da_name_idx" ON "lark_kpi_do_da"("name");
CREATE INDEX "lark_kpi_do_da_employee_id_idx" ON "lark_kpi_do_da"("employee_id");
