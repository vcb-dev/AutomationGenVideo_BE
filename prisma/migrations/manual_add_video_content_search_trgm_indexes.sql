-- Phase 2 (nhân rộng) — index cho các cột nội dung video dùng trong search (q)
-- của scraper-aggregate-read.service.ts (allExternalVideos/ownedChannelVideos).
-- Dùng immutable_unaccent() từ migration 20260716000000.

CREATE INDEX IF NOT EXISTS "scraper_facebook_reels_content_trgm"
  ON "scraper_facebook_reels"
  USING gin (lower(immutable_unaccent(content)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "scraper_tiktok_profile_videos_description_trgm"
  ON "scraper_tiktok_profile_videos"
  USING gin (lower(immutable_unaccent(description)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "scraper_instagram_reels_description_trgm"
  ON "scraper_instagram_reels"
  USING gin (lower(immutable_unaccent(description)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "scraper_douyin_videos_description_trgm"
  ON "scraper_douyin_videos"
  USING gin (lower(immutable_unaccent(description)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "scraper_xiaohongshu_videos_title_trgm"
  ON "scraper_xiaohongshu_videos"
  USING gin (lower(immutable_unaccent(title)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "scraper_xiaohongshu_videos_description_trgm"
  ON "scraper_xiaohongshu_videos"
  USING gin (lower(immutable_unaccent(description)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "scraper_youtube_shorts_title_trgm"
  ON "scraper_youtube_shorts"
  USING gin (lower(immutable_unaccent(title)) gin_trgm_ops);
