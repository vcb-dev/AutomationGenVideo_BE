-- CreateTable
CREATE TABLE "scraper_tiktok_profiles" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" VARCHAR(50) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "nickname" VARCHAR(500) NOT NULL DEFAULT '',
    "url" VARCHAR(1000) NOT NULL,
    "avatar_url" TEXT,
    "avatar_url_hd" TEXT,
    "biography" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "predicted_lang" VARCHAR(10) NOT NULL DEFAULT '',
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "following_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "videos_count" INTEGER NOT NULL DEFAULT 0,
    "avg_engagement_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "like_engagement_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comment_engagement_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "account_created_at" TIMESTAMPTZ(6),
    "is_commerce_user" BOOLEAN NOT NULL DEFAULT false,
    "is_tracked" BOOLEAN NOT NULL DEFAULT false,
    "is_bookmarked" BOOLEAN NOT NULL DEFAULT false,
    "is_initial_scraped" BOOLEAN NOT NULL DEFAULT false,
    "last_scraped_at" TIMESTAMPTZ(6),
    "scraping_status" VARCHAR(20) NOT NULL DEFAULT 'idle',
    "scrape_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_tiktok_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_tiktok_profile_videos" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" BIGINT NOT NULL,
    "video_id" VARCHAR(50) NOT NULL,
    "shortcode" VARCHAR(50) NOT NULL DEFAULT '',
    "url" VARCHAR(1000) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cover_image" TEXT,
    "video_duration" INTEGER NOT NULL DEFAULT 0,
    "region" VARCHAR(10) NOT NULL DEFAULT '',
    "post_type" VARCHAR(20) NOT NULL DEFAULT 'video',
    "play_count" BIGINT NOT NULL DEFAULT 0,
    "digg_count" BIGINT NOT NULL DEFAULT 0,
    "comment_count" BIGINT NOT NULL DEFAULT 0,
    "share_count" BIGINT NOT NULL DEFAULT 0,
    "favorites_count" BIGINT NOT NULL DEFAULT 0,
    "music_title" VARCHAR(500) NOT NULL DEFAULT '',
    "music_author" VARCHAR(255) NOT NULL DEFAULT '',
    "original_sound" TEXT NOT NULL DEFAULT '',
    "date_posted" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_tiktok_profile_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_tiktok_profile_metrics" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" BIGINT NOT NULL,
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "following_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "videos_count" INTEGER NOT NULL DEFAULT 0,
    "avg_engagement_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_tiktok_profile_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_tiktok_profiles_profile_id_key" ON "scraper_tiktok_profiles"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "scraper_tiktok_profiles_username_key" ON "scraper_tiktok_profiles"("username");

-- CreateIndex
CREATE INDEX "scraper_tiktok_profiles_username_idx" ON "scraper_tiktok_profiles"("username");

-- CreateIndex
CREATE INDEX "scraper_tiktok_profiles_is_tracked_last_scraped_at_idx" ON "scraper_tiktok_profiles"("is_tracked", "last_scraped_at");

-- CreateIndex
CREATE INDEX "scraper_tiktok_profiles_is_bookmarked_idx" ON "scraper_tiktok_profiles"("is_bookmarked");

-- CreateIndex
CREATE INDEX "scraper_tiktok_profiles_followers_count_idx" ON "scraper_tiktok_profiles"("followers_count" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_tiktok_profile_videos_video_id_key" ON "scraper_tiktok_profile_videos"("video_id");

-- CreateIndex
CREATE INDEX "scraper_tiktok_profile_videos_profile_id_date_posted_idx" ON "scraper_tiktok_profile_videos"("profile_id", "date_posted" DESC);

-- CreateIndex
CREATE INDEX "scraper_tiktok_profile_videos_play_count_idx" ON "scraper_tiktok_profile_videos"("play_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_tiktok_profile_metrics_profile_id_captured_at_idx" ON "scraper_tiktok_profile_metrics"("profile_id", "captured_at" DESC);

-- AddForeignKey
ALTER TABLE "scraper_tiktok_profile_videos" ADD CONSTRAINT "scraper_tiktok_profile_videos_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_tiktok_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_tiktok_profile_metrics" ADD CONSTRAINT "scraper_tiktok_profile_metrics_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_tiktok_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
