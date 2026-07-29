-- CreateTable
CREATE TABLE "scraper_tiktok_videos" (
    "id" BIGSERIAL NOT NULL,
    "post_id" VARCHAR(50) NOT NULL,
    "shortcode" VARCHAR(50) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "video_url" TEXT,
    "cdn_url" TEXT,
    "preview_image" TEXT,
    "video_duration" INTEGER NOT NULL DEFAULT 0,
    "region" VARCHAR(10) NOT NULL DEFAULT '',
    "author_id" VARCHAR(50) NOT NULL DEFAULT '',
    "author_username" VARCHAR(255) NOT NULL DEFAULT '',
    "author_display_name" VARCHAR(500) NOT NULL DEFAULT '',
    "author_avatar" TEXT,
    "author_url" VARCHAR(1000) NOT NULL DEFAULT '',
    "author_followers" BIGINT NOT NULL DEFAULT 0,
    "author_is_verified" BOOLEAN NOT NULL DEFAULT false,
    "play_count" BIGINT NOT NULL DEFAULT 0,
    "digg_count" BIGINT NOT NULL DEFAULT 0,
    "comment_count" BIGINT NOT NULL DEFAULT 0,
    "share_count" BIGINT NOT NULL DEFAULT 0,
    "collect_count" BIGINT NOT NULL DEFAULT 0,
    "music_title" VARCHAR(500) NOT NULL DEFAULT '',
    "music_author" VARCHAR(255) NOT NULL DEFAULT '',
    "original_sound" TEXT,
    "search_keyword" VARCHAR(500) NOT NULL DEFAULT '',
    "date_posted" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_tiktok_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_tiktok_videos_post_id_key" ON "scraper_tiktok_videos"("post_id");

-- CreateIndex
CREATE UNIQUE INDEX "scraper_tiktok_videos_shortcode_key" ON "scraper_tiktok_videos"("shortcode");

-- CreateIndex
CREATE INDEX "scraper_tiktok_videos_author_id_idx" ON "scraper_tiktok_videos"("author_id");

-- CreateIndex
CREATE INDEX "scraper_tiktok_videos_play_count_idx" ON "scraper_tiktok_videos"("play_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_tiktok_videos_date_posted_idx" ON "scraper_tiktok_videos"("date_posted" DESC);

-- CreateIndex
CREATE INDEX "scraper_tiktok_videos_search_keyword_idx" ON "scraper_tiktok_videos"("search_keyword");
