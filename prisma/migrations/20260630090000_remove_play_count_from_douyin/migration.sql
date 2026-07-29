-- Drop play_count column from scraper_douyin_videos
-- Douyin API không trả về lượt xem
DROP INDEX IF EXISTS "scraper_douyin_videos_play_count_idx";
ALTER TABLE "scraper_douyin_videos" DROP COLUMN IF EXISTS "play_count";
