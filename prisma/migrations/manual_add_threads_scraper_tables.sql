-- Create scraper_threads_profiles table
CREATE TABLE IF NOT EXISTS "scraper_threads_profiles" (
    "id" BIGSERIAL NOT NULL,
    "threads_user_id" VARCHAR(100),
    "username" VARCHAR(255) NOT NULL,
    "name" VARCHAR(500) DEFAULT '',
    "url" VARCHAR(1000) NOT NULL DEFAULT '',
    "avatar_url" TEXT,
    "avatar_drive_url" TEXT NOT NULL DEFAULT '',
    "biography" TEXT DEFAULT '',
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_tracked" BOOLEAN NOT NULL DEFAULT false,
    "is_bookmarked" BOOLEAN NOT NULL DEFAULT false,
    "is_owned" BOOLEAN NOT NULL DEFAULT true,
    "last_scraped_at" TIMESTAMPTZ(6),
    "scraping_status" VARCHAR(20) NOT NULL DEFAULT 'idle',
    "scrape_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_threads_profiles_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS "scraper_threads_profiles_username_key" ON "scraper_threads_profiles"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "scraper_threads_profiles_threads_user_id_key" ON "scraper_threads_profiles"("threads_user_id");

-- Indexes for profiles
CREATE INDEX IF NOT EXISTS "scraper_threads_profiles_username_idx" ON "scraper_threads_profiles"("username");
CREATE INDEX IF NOT EXISTS "scraper_threads_profiles_is_tracked_last_scraped_at_idx" ON "scraper_threads_profiles"("is_tracked", "last_scraped_at");
CREATE INDEX IF NOT EXISTS "scraper_threads_profiles_is_owned_idx" ON "scraper_threads_profiles"("is_owned");
CREATE INDEX IF NOT EXISTS "scraper_threads_profiles_followers_count_idx" ON "scraper_threads_profiles"("followers_count" DESC);

-- Create scraper_threads_posts table
CREATE TABLE IF NOT EXISTS "scraper_threads_posts" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" BIGINT NOT NULL,
    "post_id" VARCHAR(100) NOT NULL,
    "shortcode" VARCHAR(100),
    "url" VARCHAR(1000) NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thumbnail_url" TEXT,
    "thumbnail_drive_url" TEXT,
    "media_type" VARCHAR(50) DEFAULT 'TEXT',
    "views_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "replies_count" BIGINT NOT NULL DEFAULT 0,
    "reposts_count" BIGINT NOT NULL DEFAULT 0,
    "quotes_count" BIGINT NOT NULL DEFAULT 0,
    "date_posted" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_threads_posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scraper_threads_posts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_threads_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Unique constraints & Indexes for posts
CREATE UNIQUE INDEX IF NOT EXISTS "scraper_threads_posts_post_id_key" ON "scraper_threads_posts"("post_id");
CREATE INDEX IF NOT EXISTS "scraper_threads_posts_profile_id_date_posted_idx" ON "scraper_threads_posts"("profile_id", "date_posted" DESC);
CREATE INDEX IF NOT EXISTS "scraper_threads_posts_date_posted_idx" ON "scraper_threads_posts"("date_posted" DESC);
CREATE INDEX IF NOT EXISTS "scraper_threads_posts_views_count_idx" ON "scraper_threads_posts"("views_count" DESC);
