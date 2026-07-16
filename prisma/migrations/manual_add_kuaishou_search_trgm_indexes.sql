-- Phase 2 (nhân rộng) — Kuaishou. Dùng bởi KuaishouScraperReadService::
-- listVideos/keywordSuggest (scraper_kuaishou_search_videos) và profileVideos
-- (scraper_kuaishou_videos).

CREATE INDEX IF NOT EXISTS "scraper_kuaishou_search_videos_description_trgm"
  ON "scraper_kuaishou_search_videos"
  USING gin (lower(immutable_unaccent(description)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "scraper_kuaishou_search_videos_search_keyword_trgm"
  ON "scraper_kuaishou_search_videos"
  USING gin (lower(immutable_unaccent(search_keyword)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "scraper_kuaishou_videos_description_trgm"
  ON "scraper_kuaishou_videos"
  USING gin (lower(immutable_unaccent(description)) gin_trgm_ops);
