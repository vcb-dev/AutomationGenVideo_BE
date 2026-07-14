-- Priority 1: Btree indexes for filter/sort columns missing from schema

-- ScraperFanpage: is_bookmarked filter
CREATE INDEX IF NOT EXISTS "scraper_fanpages_is_bookmarked_idx" ON "scraper_fanpages"("is_bookmarked");

-- ScraperFacebookReel: standalone date_posted + likes_count
CREATE INDEX IF NOT EXISTS "scraper_facebook_reels_date_posted_idx" ON "scraper_facebook_reels"("date_posted" DESC);
CREATE INDEX IF NOT EXISTS "scraper_facebook_reels_likes_count_idx" ON "scraper_facebook_reels"("likes_count" DESC);

-- ScraperDouyinVideo: digg_count filter/sort
CREATE INDEX IF NOT EXISTS "scraper_douyin_videos_digg_count_idx" ON "scraper_douyin_videos"("digg_count" DESC);

-- ScraperDouyinProfile: nickname search (btree for equality; trgm GIN below for ILIKE)
CREATE INDEX IF NOT EXISTS "scraper_douyin_profiles_nickname_idx" ON "scraper_douyin_profiles"("nickname");

-- ScraperTikTokProfileVideo: standalone date_posted for cross-profile range scans
CREATE INDEX IF NOT EXISTS "scraper_tiktok_profile_videos_date_posted_idx" ON "scraper_tiktok_profile_videos"("date_posted" DESC);

-- ScraperInstagramReel: standalone date_posted for cross-profile range scans
CREATE INDEX IF NOT EXISTS "scraper_instagram_reels_date_posted_idx" ON "scraper_instagram_reels"("date_posted" DESC);

-- ScraperXiaohongshuVideo: collected_count sort
CREATE INDEX IF NOT EXISTS "scraper_xiaohongshu_videos_collected_count_idx" ON "scraper_xiaohongshu_videos"("collected_count" DESC);

-- ScraperXiaohongshuProfile: is_bookmarked filter
CREATE INDEX IF NOT EXISTS "scraper_xiaohongshu_profiles_is_bookmarked_idx" ON "scraper_xiaohongshu_profiles"("is_bookmarked");

-- ScraperYoutubeProfile: is_owned filter (every internal YouTube query uses this)
CREATE INDEX IF NOT EXISTS "scraper_youtube_profiles_is_owned_idx" ON "scraper_youtube_profiles"("is_owned");

-- video_management_ownedvideocontent: like_count filter
CREATE INDEX IF NOT EXISTS "video_management_ownedvideocontent_like_count_idx" ON "video_management_ownedvideocontent"("like_count");

-- Priority 2: GIN indexes for array containment and ILIKE text search
-- Requires pg_trgm extension; ILIKE '%pattern%' on gin_trgm_ops columns is accelerated by PostgreSQL.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- XHS keywords array: containment operator (@>) used by Prisma { has: value }
CREATE INDEX IF NOT EXISTS "scraper_xiaohongshu_videos_keywords_gin" ON "scraper_xiaohongshu_videos" USING gin("keywords");

-- Profile nickname/username: trgm GIN for ILIKE '%search%' (used after service refactor)
CREATE INDEX IF NOT EXISTS "scraper_tiktok_profiles_nickname_trgm" ON "scraper_tiktok_profiles" USING gin("nickname" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "scraper_tiktok_profiles_username_trgm" ON "scraper_tiktok_profiles" USING gin("username" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "scraper_instagram_profiles_username_trgm" ON "scraper_instagram_profiles" USING gin("username" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "scraper_douyin_profiles_nickname_trgm" ON "scraper_douyin_profiles" USING gin("nickname" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "scraper_bilibili_profiles_nickname_trgm" ON "scraper_bilibili_profiles" USING gin("nickname" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "scraper_bilibili_profiles_username_trgm" ON "scraper_bilibili_profiles" USING gin("username" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "scraper_kuaishou_profiles_nickname_trgm" ON "scraper_kuaishou_profiles" USING gin("nickname" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "scraper_kuaishou_profiles_username_trgm" ON "scraper_kuaishou_profiles" USING gin("username" gin_trgm_ops);
