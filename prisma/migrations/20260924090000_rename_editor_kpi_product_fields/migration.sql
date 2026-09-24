-- KPI editor: 2 chỉ tiêu sản phẩm được đổi tên cho khớp đúng nhãn đang hiển thị trên UI
-- ("Số sản phẩm GMV" / "Số sản phẩm Traffic") — tên cột cũ (product_planned = "SP đẩy video theo
-- kế hoạch", product_win_collect = "SP sưu tầm và test video win") không còn phản ánh chỉ tiêu
-- thật, gây đọc sai khi đối chiếu số thực đạt lấy từ breakdown dòng sản phẩm GMV/TRAFFIC/PROFIT.
-- RENAME (không DROP + ADD) để giữ nguyên target leader/admin đã nhập cho các tháng cũ.
-- Idempotent: chỉ rename khi cột cũ còn tồn tại và cột mới chưa có.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'editor_kpis' AND column_name = 'product_planned'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'editor_kpis' AND column_name = 'product_gmv'
  ) THEN
    ALTER TABLE "editor_kpis" RENAME COLUMN "product_planned" TO "product_gmv";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'editor_kpis' AND column_name = 'product_win_collect'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'editor_kpis' AND column_name = 'product_traffic'
  ) THEN
    ALTER TABLE "editor_kpis" RENAME COLUMN "product_win_collect" TO "product_traffic";
  END IF;
END $$;

-- Với DB chưa từng có cột cũ (môi trường mới dựng), vẫn phải đảm bảo cột mới tồn tại.
ALTER TABLE "editor_kpis" ADD COLUMN IF NOT EXISTS "product_gmv" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "editor_kpis" ADD COLUMN IF NOT EXISTS "product_traffic" INTEGER NOT NULL DEFAULT 0;
