-- Migration: Bổ sung channel_type và product_lines cho 7 bảng profile scraper còn lại

-- 1. TikTok
ALTER TABLE "scraper_tiktok_profiles" ADD COLUMN IF NOT EXISTS "channel_type" VARCHAR(20) NOT NULL DEFAULT 'product';
ALTER TABLE "scraper_tiktok_profiles" ADD COLUMN IF NOT EXISTS "product_lines" TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
CREATE INDEX IF NOT EXISTS "scraper_tiktok_profiles_channel_type_idx" ON "scraper_tiktok_profiles"("channel_type");
CREATE INDEX IF NOT EXISTS "scraper_tiktok_profiles_product_lines_gin" ON "scraper_tiktok_profiles" USING GIN ("product_lines");

-- 2. Instagram
ALTER TABLE "scraper_instagram_profiles" ADD COLUMN IF NOT EXISTS "channel_type" VARCHAR(20) NOT NULL DEFAULT 'product';
ALTER TABLE "scraper_instagram_profiles" ADD COLUMN IF NOT EXISTS "product_lines" TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
CREATE INDEX IF NOT EXISTS "scraper_instagram_profiles_channel_type_idx" ON "scraper_instagram_profiles"("channel_type");
CREATE INDEX IF NOT EXISTS "scraper_instagram_profiles_product_lines_gin" ON "scraper_instagram_profiles" USING GIN ("product_lines");

-- 3. YouTube
ALTER TABLE "scraper_youtube_profiles" ADD COLUMN IF NOT EXISTS "channel_type" VARCHAR(20) NOT NULL DEFAULT 'product';
ALTER TABLE "scraper_youtube_profiles" ADD COLUMN IF NOT EXISTS "product_lines" TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
CREATE INDEX IF NOT EXISTS "scraper_youtube_profiles_channel_type_idx" ON "scraper_youtube_profiles"("channel_type");
CREATE INDEX IF NOT EXISTS "scraper_youtube_profiles_product_lines_gin" ON "scraper_youtube_profiles" USING GIN ("product_lines");

-- 4. Douyin
ALTER TABLE "scraper_douyin_profiles" ADD COLUMN IF NOT EXISTS "channel_type" VARCHAR(20) NOT NULL DEFAULT 'product';
ALTER TABLE "scraper_douyin_profiles" ADD COLUMN IF NOT EXISTS "product_lines" TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
CREATE INDEX IF NOT EXISTS "scraper_douyin_profiles_channel_type_idx" ON "scraper_douyin_profiles"("channel_type");
CREATE INDEX IF NOT EXISTS "scraper_douyin_profiles_product_lines_gin" ON "scraper_douyin_profiles" USING GIN ("product_lines");

-- 5. XiaoHongShu
ALTER TABLE "scraper_xiaohongshu_profiles" ADD COLUMN IF NOT EXISTS "channel_type" VARCHAR(20) NOT NULL DEFAULT 'product';
ALTER TABLE "scraper_xiaohongshu_profiles" ADD COLUMN IF NOT EXISTS "product_lines" TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
CREATE INDEX IF NOT EXISTS "scraper_xiaohongshu_profiles_channel_type_idx" ON "scraper_xiaohongshu_profiles"("channel_type");
CREATE INDEX IF NOT EXISTS "scraper_xiaohongshu_profiles_product_lines_gin" ON "scraper_xiaohongshu_profiles" USING GIN ("product_lines");

-- 6. KuaiShou
ALTER TABLE "scraper_kuaishou_profiles" ADD COLUMN IF NOT EXISTS "channel_type" VARCHAR(20) NOT NULL DEFAULT 'product';
ALTER TABLE "scraper_kuaishou_profiles" ADD COLUMN IF NOT EXISTS "product_lines" TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
CREATE INDEX IF NOT EXISTS "scraper_kuaishou_profiles_channel_type_idx" ON "scraper_kuaishou_profiles"("channel_type");
CREATE INDEX IF NOT EXISTS "scraper_kuaishou_profiles_product_lines_gin" ON "scraper_kuaishou_profiles" USING GIN ("product_lines");

-- 7. Bilibili
ALTER TABLE "scraper_bilibili_profiles" ADD COLUMN IF NOT EXISTS "channel_type" VARCHAR(20) NOT NULL DEFAULT 'product';
ALTER TABLE "scraper_bilibili_profiles" ADD COLUMN IF NOT EXISTS "product_lines" TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
CREATE INDEX IF NOT EXISTS "scraper_bilibili_profiles_channel_type_idx" ON "scraper_bilibili_profiles"("channel_type");
CREATE INDEX IF NOT EXISTS "scraper_bilibili_profiles_product_lines_gin" ON "scraper_bilibili_profiles" USING GIN ("product_lines");
