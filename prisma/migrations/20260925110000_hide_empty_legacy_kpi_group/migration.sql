-- Nhóm này chỉ phục vụ các KPI linh hoạt cũ. Không hiển thị như nhóm mặc định thứ tư;
-- API chỉ trả nó cho team thực sự còn dữ liệu legacy.
UPDATE "performance_kpi_groups"
SET "is_system" = false,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'LEGACY_FLEXIBLE';
