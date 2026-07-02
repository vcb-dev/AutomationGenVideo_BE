-- Add missing columns to social_accounts table
-- Run: psql $DATABASE_URL < prisma/migrations/manual_add_social_account_fields.sql

ALTER TABLE "social_accounts"
  ADD COLUMN IF NOT EXISTS "parent_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "is_shared"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "thumb_url"   TEXT;

-- Add foreign key for parent_id (self-referencing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_accounts_parent_id_fkey'
  ) THEN
    ALTER TABLE "social_accounts"
      ADD CONSTRAINT "social_accounts_parent_id_fkey"
      FOREIGN KEY ("parent_id") REFERENCES "social_accounts"("id");
  END IF;
END $$;

-- Add indexes
CREATE INDEX IF NOT EXISTS "social_accounts_parent_id_idx"   ON "social_accounts"("parent_id");
CREATE INDEX IF NOT EXISTS "social_accounts_is_shared_idx"   ON "social_accounts"("is_shared");
CREATE INDEX IF NOT EXISTS "social_accounts_token_expires_at_idx" ON "social_accounts"("token_expires_at");

-- Add thumb_url to social_posts if missing
ALTER TABLE "social_posts"
  ADD COLUMN IF NOT EXISTS "thumb_url" TEXT;

-- Add user_id FK to social_posts if missing (older migration may not have it)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_user_id_fkey'
  ) THEN
    ALTER TABLE "social_posts"
      ADD CONSTRAINT "social_posts_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "social_posts_next_retry_at_idx" ON "social_posts"("next_retry_at");
CREATE INDEX IF NOT EXISTS "social_posts_updated_at_idx"    ON "social_posts"("updated_at");
