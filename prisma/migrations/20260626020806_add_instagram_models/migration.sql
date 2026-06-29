-- CreateTable
CREATE TABLE "scraper_instagram_profiles" (
    "id" BIGSERIAL NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "avatar_url" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "following_count" BIGINT NOT NULL DEFAULT 0,
    "posts_count" INTEGER NOT NULL DEFAULT 0,
    "is_tracked" BOOLEAN NOT NULL DEFAULT false,
    "is_bookmarked" BOOLEAN NOT NULL DEFAULT false,
    "is_initial_scraped" BOOLEAN NOT NULL DEFAULT false,
    "last_scraped_at" TIMESTAMPTZ(6),
    "scraping_status" VARCHAR(20) NOT NULL DEFAULT 'idle',
    "scrape_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_instagram_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_instagram_reels" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" BIGINT NOT NULL,
    "post_id" VARCHAR(50) NOT NULL,
    "shortcode" VARCHAR(50) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thumbnail_url" TEXT,
    "duration_seconds" DOUBLE PRECISION,
    "is_paid_partnership" BOOLEAN NOT NULL DEFAULT false,
    "views_count" BIGINT NOT NULL DEFAULT 0,
    "play_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "comments_count" BIGINT NOT NULL DEFAULT 0,
    "date_posted" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_instagram_reels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_instagram_profile_metrics" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" BIGINT NOT NULL,
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "following_count" BIGINT NOT NULL DEFAULT 0,
    "posts_count" INTEGER NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_instagram_profile_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_instagram_profiles_username_key" ON "scraper_instagram_profiles"("username");

-- CreateIndex
CREATE INDEX "scraper_instagram_profiles_username_idx" ON "scraper_instagram_profiles"("username");

-- CreateIndex
CREATE INDEX "scraper_instagram_profiles_is_tracked_last_scraped_at_idx" ON "scraper_instagram_profiles"("is_tracked", "last_scraped_at");

-- CreateIndex
CREATE INDEX "scraper_instagram_profiles_is_bookmarked_idx" ON "scraper_instagram_profiles"("is_bookmarked");

-- CreateIndex
CREATE INDEX "scraper_instagram_profiles_followers_count_idx" ON "scraper_instagram_profiles"("followers_count" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_instagram_reels_post_id_key" ON "scraper_instagram_reels"("post_id");

-- CreateIndex
CREATE UNIQUE INDEX "scraper_instagram_reels_shortcode_key" ON "scraper_instagram_reels"("shortcode");

-- CreateIndex
CREATE INDEX "scraper_instagram_reels_profile_id_date_posted_idx" ON "scraper_instagram_reels"("profile_id", "date_posted" DESC);

-- CreateIndex
CREATE INDEX "scraper_instagram_reels_play_count_idx" ON "scraper_instagram_reels"("play_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_instagram_profile_metrics_profile_id_captured_at_idx" ON "scraper_instagram_profile_metrics"("profile_id", "captured_at" DESC);

-- AddForeignKey
ALTER TABLE "scraper_instagram_reels" ADD CONSTRAINT "scraper_instagram_reels_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_instagram_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_instagram_profile_metrics" ADD CONSTRAINT "scraper_instagram_profile_metrics_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_instagram_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
