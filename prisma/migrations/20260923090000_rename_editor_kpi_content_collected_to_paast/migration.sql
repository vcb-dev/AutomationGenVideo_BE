-- KPI editor: chỉ tiêu "Content sưu tầm về kho team" được đổi thành "Content phân tích theo PAAST".
-- RENAME (không DROP + ADD) để giữ nguyên số target leader/admin đã nhập cho các tháng cũ.
-- Idempotent: chỉ rename khi cột cũ còn tồn tại và cột mới chưa có.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'editor_kpis' AND column_name = 'content_collected'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'editor_kpis' AND column_name = 'content_paast_analyzed'
  ) THEN
    ALTER TABLE "editor_kpis" RENAME COLUMN "content_collected" TO "content_paast_analyzed";
  END IF;
END $$;

-- Với DB chưa từng có cột cũ (môi trường mới dựng), vẫn phải đảm bảo cột mới tồn tại.
ALTER TABLE "editor_kpis" ADD COLUMN IF NOT EXISTS "content_paast_analyzed" INTEGER NOT NULL DEFAULT 0;

-- Số THỰC ĐẠT của chỉ tiêu trên đếm task có content mang đúng phân loại này (tasks.service.ts
-- countPaastAnalyzedTasks / kpi.service.ts getEditorKpis) — tên phân loại là khoá tra cứu, nên
-- seed sẵn để leader không phải tự gõ đúng từng chữ khi phân loại content.
INSERT INTO "content_classifications" ("id", "name", "created_at", "updated_at")
SELECT gen_random_uuid(), 'Phân tích theo PAAST', NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "content_classifications" WHERE "name" = 'Phân tích theo PAAST'
);
