-- Phase 2 (nhân rộng) — TikTok. scraper_tiktok_videos (kết quả search theo
-- keyword) chỉ có btree index trên search_keyword (tốt cho equality, không
-- tăng tốc được contains/ILIKE) và KHÔNG có index nào cho description — cả 2
-- cột hiện đang bị TiktokScraperReadService::listVideos ILIKE full scan.

CREATE INDEX IF NOT EXISTS "scraper_tiktok_videos_description_trgm"
  ON "scraper_tiktok_videos"
  USING gin (lower(immutable_unaccent(description)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "scraper_tiktok_videos_search_keyword_trgm"
  ON "scraper_tiktok_videos"
  USING gin (lower(immutable_unaccent(search_keyword)) gin_trgm_ops);

-- scraper_tiktok_profile_videos.description — dùng bởi
-- TiktokScraperReadService::profileVideos (search trong video của 1 profile).
CREATE INDEX IF NOT EXISTS "scraper_tiktok_profile_videos_description_trgm"
  ON "scraper_tiktok_profile_videos"
  USING gin (lower(immutable_unaccent(description)) gin_trgm_ops);
