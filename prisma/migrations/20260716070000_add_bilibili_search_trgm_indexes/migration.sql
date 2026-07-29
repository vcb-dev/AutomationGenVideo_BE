-- Phase 2 (nhân rộng) — Bilibili. Dùng bởi BilibiliScraperReadService::
-- listVideos/keywordSuggest (scraper_bilibili_search_videos) và profileVideos
-- (scraper_bilibili_videos).

CREATE INDEX IF NOT EXISTS "scraper_bilibili_search_videos_description_trgm"
  ON "scraper_bilibili_search_videos"
  USING gin (lower(immutable_unaccent(description)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "scraper_bilibili_search_videos_search_keyword_trgm"
  ON "scraper_bilibili_search_videos"
  USING gin (lower(immutable_unaccent(search_keyword)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "scraper_bilibili_videos_description_trgm"
  ON "scraper_bilibili_videos"
  USING gin (lower(immutable_unaccent(description)) gin_trgm_ops);
