-- CreateTable
CREATE TABLE "scraper_kuaishou_search_videos" (
    "id" BIGSERIAL NOT NULL,
    "post_id" VARCHAR(50) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thumbnail_url" TEXT,
    "video_duration" INTEGER NOT NULL DEFAULT 0,
    "author_id" VARCHAR(50) NOT NULL DEFAULT '',
    "author_eid" VARCHAR(50) NOT NULL DEFAULT '',
    "author_username" VARCHAR(500) NOT NULL DEFAULT '',
    "author_avatar" TEXT,
    "author_is_verified" BOOLEAN NOT NULL DEFAULT false,
    "view_count" BIGINT NOT NULL DEFAULT 0,
    "like_count" BIGINT NOT NULL DEFAULT 0,
    "comment_count" BIGINT NOT NULL DEFAULT 0,
    "share_count" BIGINT NOT NULL DEFAULT 0,
    "collect_count" BIGINT NOT NULL DEFAULT 0,
    "search_keyword" VARCHAR(500) NOT NULL DEFAULT '',
    "date_posted" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_kuaishou_search_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_kuaishou_search_videos_post_id_key" ON "scraper_kuaishou_search_videos"("post_id");

-- CreateIndex
CREATE INDEX "scraper_kuaishou_search_videos_author_id_idx" ON "scraper_kuaishou_search_videos"("author_id");

-- CreateIndex
CREATE INDEX "scraper_kuaishou_search_videos_view_count_idx" ON "scraper_kuaishou_search_videos"("view_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_kuaishou_search_videos_like_count_idx" ON "scraper_kuaishou_search_videos"("like_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_kuaishou_search_videos_date_posted_idx" ON "scraper_kuaishou_search_videos"("date_posted" DESC);

-- CreateIndex
CREATE INDEX "scraper_kuaishou_search_videos_created_at_idx" ON "scraper_kuaishou_search_videos"("created_at" DESC);

-- CreateIndex
CREATE INDEX "scraper_kuaishou_search_videos_search_keyword_idx" ON "scraper_kuaishou_search_videos"("search_keyword");
