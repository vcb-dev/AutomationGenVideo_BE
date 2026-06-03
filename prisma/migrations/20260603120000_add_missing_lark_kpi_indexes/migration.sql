-- Thêm các index bị thiếu cho lark_kpi
-- Migration gốc (20260209032437) tạo bảng KHÔNG có index.
-- Migration 9 (20260310034214) chỉ thêm 4/7 index.
-- Các index report_date+team, state+month+team, report_date DESC CHƯA có migration.

-- Index composite cho query getUserActivityReports() — filter theo report_date + team
CREATE INDEX IF NOT EXISTS "lark_kpi_report_date_team_idx" ON "lark_kpi"("report_date", "team");

-- Index composite cho query filter theo state + month + team
CREATE INDEX IF NOT EXISTS "lark_kpi_state_month_team_idx" ON "lark_kpi"("state", "month", "team");

-- Index report_date DESC cho ORDER BY report_date DESC (getKPIData pagination)
CREATE INDEX IF NOT EXISTS "lark_kpi_report_date_desc_idx" ON "lark_kpi"("report_date" DESC);

-- Index composite month + report_date cho query filter theo tháng + ngày
CREATE INDEX IF NOT EXISTS "lark_kpi_month_report_date_idx" ON "lark_kpi"("month", "report_date");

-- Index cho lark_report_kpi (query trong getUserActivityReports)
CREATE INDEX IF NOT EXISTS "lark_report_kpi_report_date_team_idx" ON "lark_report_kpi"("report_date", "team");
