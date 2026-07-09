-- CreateTable
CREATE TABLE "scraper_youtube_profiles" (
    "id" BIGSERIAL NOT NULL,
    "channel_id" VARCHAR(50) NOT NULL,
    "title" VARCHAR(500) NOT NULL DEFAULT '',
    "description" TEXT,
    "url" VARCHAR(1000) NOT NULL,
    "avatar_url" TEXT,
    "avatar_drive_url" TEXT NOT NULL DEFAULT '',
    "banner_url" TEXT,
    "banner_drive_url" TEXT NOT NULL DEFAULT '',
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "has_business_email" BOOLEAN NOT NULL DEFAULT false,
    "subscriber_count" BIGINT NOT NULL DEFAULT 0,
    "video_count" INTEGER NOT NULL DEFAULT 0,
    "view_count" BIGINT NOT NULL DEFAULT 0,
    "country" VARCHAR(100) NOT NULL DEFAULT '',
    "channel_created_at" TIMESTAMPTZ(6),
    "is_tracked" BOOLEAN NOT NULL DEFAULT false,
    "is_bookmarked" BOOLEAN NOT NULL DEFAULT false,
    "is_owned" BOOLEAN NOT NULL DEFAULT false,
    "is_initial_scraped" BOOLEAN NOT NULL DEFAULT false,
    "last_scraped_at" TIMESTAMPTZ(6),
    "scraping_status" VARCHAR(20) NOT NULL DEFAULT 'idle',
    "scrape_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_youtube_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_youtube_shorts" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" BIGINT NOT NULL,
    "video_id" VARCHAR(20) NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "url" VARCHAR(500) NOT NULL,
    "thumbnail_url" TEXT,
    "thumbnail_drive_url" TEXT,
    "view_count" BIGINT NOT NULL DEFAULT 0,
    "view_count_text" VARCHAR(50) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_youtube_shorts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_youtube_profiles_channel_id_key" ON "scraper_youtube_profiles"("channel_id");

-- CreateIndex
CREATE INDEX "scraper_youtube_profiles_title_idx" ON "scraper_youtube_profiles"("title");

-- CreateIndex
CREATE INDEX "scraper_youtube_profiles_is_bookmarked_idx" ON "scraper_youtube_profiles"("is_bookmarked");

-- CreateIndex
CREATE INDEX "scraper_youtube_profiles_subscriber_count_idx" ON "scraper_youtube_profiles"("subscriber_count" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_youtube_shorts_video_id_key" ON "scraper_youtube_shorts"("video_id");

-- CreateIndex
CREATE INDEX "scraper_youtube_shorts_profile_id_view_count_idx" ON "scraper_youtube_shorts"("profile_id", "view_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_youtube_shorts_view_count_idx" ON "scraper_youtube_shorts"("view_count" DESC);

-- AddForeignKey
ALTER TABLE "scraper_youtube_shorts" ADD CONSTRAINT "scraper_youtube_shorts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_youtube_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
