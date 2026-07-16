-- Phase 2 (nhân rộng) — Facebook external. scraper_facebook_reels.content đã
-- có trgm index (migration 20260716020000). Thêm scraper_fanpages.name — dùng
-- bởi FacebookExternalScraperReadService::discoveredFanpages.

CREATE INDEX IF NOT EXISTS "scraper_fanpages_name_trgm"
  ON "scraper_fanpages"
  USING gin (lower(immutable_unaccent(name)) gin_trgm_ops);
