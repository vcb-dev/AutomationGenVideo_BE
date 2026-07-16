-- Phase 2 (nhân rộng) — YouTube. scraper_youtube_shorts.title đã có trgm
-- index (migration 20260716020000). Thêm scraper_youtube_profiles.title —
-- dùng bởi YoutubeScraperReadService::listProfiles (search theo tên channel).

CREATE INDEX IF NOT EXISTS "scraper_youtube_profiles_title_trgm"
  ON "scraper_youtube_profiles"
  USING gin (lower(immutable_unaccent(title)) gin_trgm_ops);
