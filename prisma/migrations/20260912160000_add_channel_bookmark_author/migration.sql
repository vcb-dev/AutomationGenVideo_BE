-- Migration: Add bookmarked_by_id, bookmarked_by_name, bookmarked_at to all 8 scraper channel/profile tables

-- 1. Instagram
ALTER TABLE "scraper_instagram_profiles"
  ADD COLUMN IF NOT EXISTS "bookmarked_by_id" UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_by_name" VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_at" TIMESTAMPTZ(6) DEFAULT NULL;

-- 2. TikTok
ALTER TABLE "scraper_tiktok_profiles"
  ADD COLUMN IF NOT EXISTS "bookmarked_by_id" UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_by_name" VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_at" TIMESTAMPTZ(6) DEFAULT NULL;

-- 3. YouTube
ALTER TABLE "scraper_youtube_profiles"
  ADD COLUMN IF NOT EXISTS "bookmarked_by_id" UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_by_name" VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_at" TIMESTAMPTZ(6) DEFAULT NULL;

-- 4. Facebook Fanpages
ALTER TABLE "scraper_fanpages"
  ADD COLUMN IF NOT EXISTS "bookmarked_by_id" UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_by_name" VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_at" TIMESTAMPTZ(6) DEFAULT NULL;

-- 5. Douyin
ALTER TABLE "scraper_douyin_profiles"
  ADD COLUMN IF NOT EXISTS "bookmarked_by_id" UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_by_name" VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_at" TIMESTAMPTZ(6) DEFAULT NULL;

-- 6. XiaoHongShu
ALTER TABLE "scraper_xiaohongshu_profiles"
  ADD COLUMN IF NOT EXISTS "bookmarked_by_id" UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_by_name" VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_at" TIMESTAMPTZ(6) DEFAULT NULL;

-- 7. KuaiShou
ALTER TABLE "scraper_kuaishou_profiles"
  ADD COLUMN IF NOT EXISTS "bookmarked_by_id" UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_by_name" VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_at" TIMESTAMPTZ(6) DEFAULT NULL;

-- 8. Bilibili
ALTER TABLE "scraper_bilibili_profiles"
  ADD COLUMN IF NOT EXISTS "bookmarked_by_id" UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_by_name" VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "bookmarked_at" TIMESTAMPTZ(6) DEFAULT NULL;
