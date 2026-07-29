-- Drop editor_weekend_kpis table: weekend/Sunday KPI is no longer tracked separately,
-- all days are now treated the same via editor_kpis.
DROP TABLE IF EXISTS "editor_weekend_kpis";
