-- Phase 2 (nhân rộng) — Douyin. description đã có trgm index (migration
-- 20260716020000). Thêm search_keyword — dùng bởi
-- DouyinScraperReadService::listVideos/keywordSuggest.

CREATE INDEX IF NOT EXISTS "scraper_douyin_videos_search_keyword_trgm"
  ON "scraper_douyin_videos"
  USING gin (lower(immutable_unaccent(search_keyword)) gin_trgm_ops);
