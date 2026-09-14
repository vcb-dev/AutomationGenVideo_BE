-- Thêm số SP Profit vào editor_kpis, hoàn thiện bộ 3 GMV/Traffic/Profit theo dòng sản phẩm
-- (product_planned = GMV, product_win_collect = Traffic, product_profit = Profit)
ALTER TABLE "editor_kpis" ADD COLUMN IF NOT EXISTS "product_profit" INTEGER NOT NULL DEFAULT 0;
