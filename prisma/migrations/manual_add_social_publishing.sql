-- Social Publishing migration (VCB-tool integration)
-- Run: psql $DATABASE_URL < prisma/migrations/manual_add_social_publishing.sql

CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'THREADS', 'YOUTUBE', 'ZALO');
CREATE TYPE "SocialPostStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "SocialPostSource" AS ENUM ('IMMEDIATE', 'SCHEDULED');

CREATE TABLE "social_accounts" (
  "id"                 TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id"            TEXT NOT NULL,
  "platform"           "SocialPlatform" NOT NULL,
  "platform_id"        TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "username"           TEXT,
  "avatar_url"         TEXT,
  "access_token_enc"   TEXT NOT NULL,
  "refresh_token_enc"  TEXT,
  "token_expires_at"   TIMESTAMPTZ,
  "parent_id"          TEXT,
  "extra_data"         JSONB,
  "is_active"          BOOLEAN NOT NULL DEFAULT true,
  "is_shared"          BOOLEAN NOT NULL DEFAULT false,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_accounts_user_id_platform_platform_id_key" UNIQUE ("user_id", "platform", "platform_id"),
  CONSTRAINT "social_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "social_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "social_accounts"("id") ON DELETE SET NULL
);
CREATE INDEX "social_accounts_user_id_idx"    ON "social_accounts"("user_id");
CREATE INDEX "social_accounts_platform_idx"   ON "social_accounts"("platform");
CREATE INDEX "social_accounts_parent_id_idx"  ON "social_accounts"("parent_id");
CREATE INDEX "social_accounts_is_active_idx"  ON "social_accounts"("is_active");
CREATE INDEX "social_accounts_is_shared_idx"  ON "social_accounts"("is_shared");
CREATE INDEX "social_accounts_token_expires_at_idx" ON "social_accounts"("token_expires_at");
CREATE INDEX "social_accounts_is_active_token_expires_at_idx" ON "social_accounts"("is_active", "token_expires_at");

CREATE TABLE "social_posts" (
  "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id"       TEXT NOT NULL,
  "account_id"    TEXT NOT NULL,
  "platform"      "SocialPlatform" NOT NULL,
  "message"       TEXT NOT NULL,
  "media_urls"    TEXT[] NOT NULL DEFAULT '{}',
  "page_id"       TEXT,
  "privacy"       TEXT DEFAULT 'PUBLIC',
  "status"        "SocialPostStatus" NOT NULL DEFAULT 'PENDING',
  "source"        "SocialPostSource" NOT NULL DEFAULT 'IMMEDIATE',
  "scheduled_at"  TIMESTAMPTZ,
  "executed_at"   TIMESTAMPTZ,
  "retry_count"   INT NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMPTZ,
  "result"        JSONB,
  "error_msg"     TEXT,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_posts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE
);
CREATE INDEX "social_posts_user_id_idx"      ON "social_posts"("user_id");
CREATE INDEX "social_posts_account_id_idx"   ON "social_posts"("account_id");
CREATE INDEX "social_posts_status_idx"       ON "social_posts"("status");
CREATE INDEX "social_posts_source_idx"       ON "social_posts"("source");
CREATE INDEX "social_posts_scheduled_at_idx" ON "social_posts"("scheduled_at");
CREATE INDEX "social_posts_status_scheduled_at_idx" ON "social_posts"("status", "scheduled_at");
CREATE INDEX "social_posts_status_source_updated_at_idx" ON "social_posts"("status", "source", "updated_at");

CREATE TABLE "social_drafts" (
  "id"         TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id"    TEXT NOT NULL,
  "title"      TEXT,
  "message"    TEXT NOT NULL,
  "media_urls" TEXT[] NOT NULL DEFAULT '{}',
  "platform"   "SocialPlatform",
  "account_id" TEXT,
  "page_id"    TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "social_drafts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "social_drafts_user_id_idx" ON "social_drafts"("user_id");
