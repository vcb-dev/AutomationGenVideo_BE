-- KPI editor: thêm chỉ tiêu "Số sản phẩm sưu tầm và test win" — sản phẩm được sưu tầm về kho rồi
-- test ra video win. Tách riêng khỏi product_gmv/product_traffic/product_profit vì đây là chỉ tiêu
-- theo NGUỒN GỐC sản phẩm, không phải theo dòng doanh thu.
ALTER TABLE "editor_kpis" ADD COLUMN IF NOT EXISTS "product_collect_test_win" INTEGER NOT NULL DEFAULT 0;

-- Số THỰC ĐẠT của chỉ tiêu trên đếm sản phẩm riêng biệt đứng sau task có DÒNG SẢN PHẨM "Sưu tầm"
-- (editor-kpi-actuals.util.ts, tra theo tên/video_category, bỏ qua hoa-thường) — tên dòng là khoá
-- tra cứu nên seed sẵn để leader không phải tự gõ đúng từng chữ, giống cách migration
-- 20260923090000 seed phân loại content "Phân tích theo PAAST".
INSERT INTO "product_lines" ("id", "name")
SELECT gen_random_uuid()::text, 'Sưu tầm'
WHERE NOT EXISTS (
  SELECT 1 FROM "product_lines" WHERE lower(trim("name")) = lower('Sưu tầm')
);
