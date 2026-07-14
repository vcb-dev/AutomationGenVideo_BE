-- CreateTable
CREATE TABLE "scraper_kuaishou_profiles" (
    "id" BIGSERIAL NOT NULL,
    "user_id" VARCHAR(50) NOT NULL,
    "username" VARCHAR(255) NOT NULL DEFAULT '',
    "nickname" VARCHAR(500) NOT NULL DEFAULT '',
    "url" VARCHAR(1000) NOT NULL,
    "avatar_url" TEXT,
    "avatar_drive_url" TEXT NOT NULL DEFAULT '',
    "biography" TEXT,
    "gender" VARCHAR(10) NOT NULL DEFAULT '',
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "following_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "videos_count" INTEGER NOT NULL DEFAULT 0,
    "is_tracked" BOOLEAN NOT NULL DEFAULT false,
    "is_bookmarked" BOOLEAN NOT NULL DEFAULT false,
    "is_initial_scraped" BOOLEAN NOT NULL DEFAULT false,
    "last_scraped_at" TIMESTAMPTZ(6),
    "scraping_status" VARCHAR(20) NOT NULL DEFAULT 'idle',
    "scrape_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_kuaishou_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_kuaishou_videos" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" BIGINT NOT NULL,
    "post_id" VARCHAR(50) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thumbnail_url" TEXT,
    "thumbnail_drive_url" TEXT,
    "video_duration" INTEGER NOT NULL DEFAULT 0,
    "view_count" BIGINT NOT NULL DEFAULT 0,
    "like_count" BIGINT NOT NULL DEFAULT 0,
    "comment_count" BIGINT NOT NULL DEFAULT 0,
    "share_count" BIGINT NOT NULL DEFAULT 0,
    "collect_count" BIGINT NOT NULL DEFAULT 0,
    "date_posted" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_kuaishou_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_kuaishou_profiles_user_id_key" ON "scraper_kuaishou_profiles"("user_id");

-- CreateIndex
CREATE INDEX "scraper_kuaishou_profiles_username_idx" ON "scraper_kuaishou_profiles"("username");

-- CreateIndex
CREATE INDEX "scraper_kuaishou_profiles_is_tracked_last_scraped_at_idx" ON "scraper_kuaishou_profiles"("is_tracked", "last_scraped_at");

-- CreateIndex
CREATE INDEX "scraper_kuaishou_profiles_is_bookmarked_idx" ON "scraper_kuaishou_profiles"("is_bookmarked");

-- CreateIndex
CREATE INDEX "scraper_kuaishou_profiles_followers_count_idx" ON "scraper_kuaishou_profiles"("followers_count" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_kuaishou_videos_post_id_key" ON "scraper_kuaishou_videos"("post_id");

-- CreateIndex
CREATE INDEX "scraper_kuaishou_videos_profile_id_date_posted_idx" ON "scraper_kuaishou_videos"("profile_id", "date_posted" DESC);

-- CreateIndex
CREATE INDEX "scraper_kuaishou_videos_view_count_idx" ON "scraper_kuaishou_videos"("view_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_kuaishou_videos_like_count_idx" ON "scraper_kuaishou_videos"("like_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_kuaishou_videos_comment_count_idx" ON "scraper_kuaishou_videos"("comment_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_kuaishou_videos_date_posted_idx" ON "scraper_kuaishou_videos"("date_posted" DESC);

-- CreateIndex
CREATE INDEX "scraper_kuaishou_videos_created_at_idx" ON "scraper_kuaishou_videos"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "scraper_kuaishou_videos" ADD CONSTRAINT "scraper_kuaishou_videos_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_kuaishou_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
