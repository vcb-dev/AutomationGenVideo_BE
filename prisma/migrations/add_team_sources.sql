-- Migration: tách source thành bảng riêng cho từng team
-- Tạo bảng team_sources (tương tự team_products / team_contents)

CREATE TABLE "team_sources" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "team_id"          TEXT         NOT NULL,
  "brand_type"       "BrandType"  NOT NULL DEFAULT 'DO_DA'::"BrandType",
  "type"             TEXT         NOT NULL,
  "name"             TEXT         NOT NULL,
  "link"             TEXT         NOT NULL,
  "code"             TEXT,
  "product_id"       TEXT,
  "source_source_id" TEXT,
  "added_by_id"      TEXT         NOT NULL,
  "is_active"        BOOLEAN      NOT NULL DEFAULT true,
  "added_at"         TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "team_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_sources_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE,
  CONSTRAINT "team_sources_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL,
  CONSTRAINT "team_sources_source_source_id_fkey"
    FOREIGN KEY ("source_source_id") REFERENCES "sources"("id") ON DELETE SET NULL,
  CONSTRAINT "team_sources_added_by_id_fkey"
    FOREIGN KEY ("added_by_id") REFERENCES "users"("id")
);

CREATE INDEX "team_sources_team_id_idx"             ON "team_sources"("team_id");
CREATE INDEX "team_sources_team_id_brand_type_idx"  ON "team_sources"("team_id", "brand_type");
CREATE INDEX "team_sources_team_id_type_is_active_idx" ON "team_sources"("team_id", "type", "is_active");

-- Migrate dữ liệu: sources với team_id → team_sources
-- source_source_id = source.id (vì sau khi migrate, source record trở thành global)
INSERT INTO "team_sources"
  ("team_id", "brand_type", "type", "name", "link", "code",
   "product_id", "source_source_id", "added_by_id", "is_active", "added_at", "updated_at")
SELECT
  s."team_id",
  s."brand_type",
  s."type",
  s."name",
  s."link",
  s."code",
  s."product_id",
  s."id",           -- link về source gốc
  s."added_by_id",
  s."is_active",
  s."created_at",
  s."updated_at"
FROM "sources" s
WHERE s."team_id" IS NOT NULL;

-- Xóa team_id khỏi bảng sources (sau khi migrate xong)
ALTER TABLE "sources" DROP COLUMN IF EXISTS "team_id";
DROP INDEX IF EXISTS "sources_team_id_idx";
