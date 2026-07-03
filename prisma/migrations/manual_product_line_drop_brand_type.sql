-- =============================================================
-- ProductLine dùng chung cho mọi brand (bỏ phân biệt DO_DA / TRANG_SUC)
-- 1. Gộp các dòng sản phẩm trùng tên giữa 2 brand: giữ 1 bản ghi mỗi tên,
--    trỏ lại toàn bộ FK về bản ghi được giữ, xóa bản ghi thừa.
-- 2. Drop cột brand_type + unique(name, brand_type), thêm unique(name).
-- Chạy trong 1 transaction.
-- =============================================================
BEGIN;

-- Bản ghi được giữ cho mỗi tên: id nhỏ nhất (deterministic)
CREATE TEMP TABLE pl_keep ON COMMIT DROP AS
SELECT MIN(id::text)::uuid AS keep_id, name
FROM product_lines
GROUP BY name;

-- Map các bản ghi sẽ bị xóa → bản ghi được giữ
CREATE TEMP TABLE pl_dup ON COMMIT DROP AS
SELECT pl.id AS dup_id, k.keep_id
FROM product_lines pl
JOIN pl_keep k ON k.name = pl.name AND pl.id <> k.keep_id;

-- Trỏ lại toàn bộ FK về bản ghi được giữ
UPDATE products p              SET product_line_id = d.keep_id FROM pl_dup d WHERE p.product_line_id = d.dup_id;
UPDATE team_products tp        SET product_line_id = d.keep_id FROM pl_dup d WHERE tp.product_line_id = d.dup_id;
UPDATE editor_products ep      SET product_line_id = d.keep_id FROM pl_dup d WHERE ep.product_line_id = d.dup_id;
UPDATE tasks t                 SET product_line_id = d.keep_id FROM pl_dup d WHERE t.product_line_id = d.dup_id;
UPDATE team_kpi_allocations a  SET product_line_id = d.keep_id FROM pl_dup d WHERE a.product_line_id = d.dup_id;
UPDATE editor_kpi_allocations a SET product_line_id = d.keep_id FROM pl_dup d WHERE a.product_line_id = d.dup_id;

-- Xóa các bản ghi trùng
DELETE FROM product_lines pl USING pl_dup d WHERE pl.id = d.dup_id;

-- Đổi constraint: bỏ unique(name, brand_type), drop cột, thêm unique(name)
DROP INDEX IF EXISTS "product_lines_name_brand_type_key";
ALTER TABLE product_lines DROP COLUMN IF EXISTS brand_type;
CREATE UNIQUE INDEX IF NOT EXISTS "product_lines_name_key" ON product_lines(name);

COMMIT;
