-- Add Instagram user info fields from TikHub fetch_user_info endpoint
ALTER TABLE "scraper_instagram_profiles"
  ADD COLUMN IF NOT EXISTS "instagram_id"  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "full_name"     VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "hd_avatar_url" TEXT,
  ADD COLUMN IF NOT EXISTS "biography"     TEXT,
  ADD COLUMN IF NOT EXISTS "bio_links"     JSONB,
  ADD COLUMN IF NOT EXISTS "external_url"  TEXT,
  ADD COLUMN IF NOT EXISTS "is_private"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_business"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "category"      VARCHAR(255);

-- Unique index on instagram_id (nullable — only enforced when non-null)
CREATE UNIQUE INDEX IF NOT EXISTS "scraper_instagram_profiles_instagram_id_key"
  ON "scraper_instagram_profiles"("instagram_id")
  WHERE "instagram_id" IS NOT NULL;
