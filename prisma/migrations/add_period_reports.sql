-- Migration: Thêm cột period_reports vào telegram_report_config
-- Chạy: psql $DATABASE_URL -f add_period_reports.sql

ALTER TABLE telegram_report_config
  ADD COLUMN IF NOT EXISTS period_reports TEXT[] DEFAULT '{monthly}';

COMMENT ON COLUMN telegram_report_config.period_reports IS
  'Kỳ báo cáo tự động: monthly | quarterly | semi_annual | annual';
