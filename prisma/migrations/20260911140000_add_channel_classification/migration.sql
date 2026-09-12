-- Migration: Thêm phân loại kênh (channel_type) và dòng sản phẩm (product_lines)
-- 1. Bổ sung cột cho bảng scraper_fanpages
ALTER TABLE "scraper_fanpages" ADD COLUMN IF NOT EXISTS "channel_type" VARCHAR(20) NOT NULL DEFAULT 'product';
ALTER TABLE "scraper_fanpages" ADD COLUMN IF NOT EXISTS "product_lines" TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

CREATE INDEX IF NOT EXISTS "scraper_fanpages_channel_type_idx" ON "scraper_fanpages"("channel_type");
CREATE INDEX IF NOT EXISTS "scraper_fanpages_product_lines_gin" ON "scraper_fanpages" USING GIN ("product_lines");

-- 2. Tạo bảng danh mục thẻ/nhãn dòng sản phẩm dùng chung
CREATE TABLE IF NOT EXISTS "scraper_channel_tags" (
    "id" BIGSERIAL PRIMARY KEY,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "color" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "scraper_channel_tags_name_key" ON "scraper_channel_tags"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "scraper_channel_tags_slug_key" ON "scraper_channel_tags"("slug");

-- 3. Seed 6 nhãn mặc định cho ngành trang sức
INSERT INTO "scraper_channel_tags" ("name", "slug", "color")
VALUES 
    ('Vàng', 'vang', 'amber'),
    ('Đá quý', 'da_quy', 'violet'),
    ('Kim cương', 'kim_cuong', 'cyan'),
    ('Chế tác', 'che_tac', 'emerald'),
    ('Bạc', 'bac', 'slate'),
    ('Moissanite', 'moissanite', 'blue')
ON CONFLICT ("slug") DO NOTHING;
