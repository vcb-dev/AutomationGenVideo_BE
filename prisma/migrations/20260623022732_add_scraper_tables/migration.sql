-- CreateTable
CREATE TABLE "scraper_search_keywords" (
    "id" BIGSERIAL NOT NULL,
    "raw_keyword" TEXT NOT NULL,
    "cleaned_keyword" VARCHAR(500) NOT NULL,
    "cleaned_keyword_ascii" VARCHAR(500) NOT NULL,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "is_google_active" BOOLEAN NOT NULL DEFAULT true,
    "last_searched_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_search_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_fanpages" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" VARCHAR(50) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "handle" VARCHAR(255) NOT NULL DEFAULT '',
    "page_url" VARCHAR(1000) NOT NULL DEFAULT '',
    "avatar_url" TEXT,
    "header_image_url" TEXT,
    "is_verified" BOOLEAN,
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "is_visible_on_ui" BOOLEAN NOT NULL DEFAULT true,
    "is_periodic_crawl" BOOLEAN NOT NULL DEFAULT false,
    "crawl_interval_days" INTEGER NOT NULL DEFAULT 1,
    "scraping_status" VARCHAR(20) NOT NULL DEFAULT 'idle',
    "last_scraped_at" TIMESTAMPTZ(6),
    "scrape_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_fanpages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_fanpage_keywords" (
    "id" BIGSERIAL NOT NULL,
    "fanpage_id" BIGINT NOT NULL,
    "keyword_id" BIGINT NOT NULL,

    CONSTRAINT "scraper_fanpage_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_fanpage_metrics_history" (
    "id" BIGSERIAL NOT NULL,
    "fanpage_id" BIGINT NOT NULL,
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_fanpage_metrics_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_facebook_reels" (
    "id" BIGSERIAL NOT NULL,
    "fanpage_id" BIGINT NOT NULL,
    "post_id" VARCHAR(50) NOT NULL,
    "shortcode" VARCHAR(50) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "video_url" TEXT,
    "thumbnail_url" TEXT,
    "duration_seconds" DOUBLE PRECISION,
    "has_audio" BOOLEAN NOT NULL DEFAULT true,
    "date_posted" TIMESTAMPTZ(6) NOT NULL,
    "views_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "comments_count" BIGINT NOT NULL DEFAULT 0,
    "shares_count" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_facebook_reels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_reel_metrics_history" (
    "id" BIGSERIAL NOT NULL,
    "reel_id" BIGINT NOT NULL,
    "views_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "comments_count" BIGINT NOT NULL DEFAULT 0,
    "shares_count" BIGINT NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_reel_metrics_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scraper_search_keywords_cleaned_keyword_idx" ON "scraper_search_keywords"("cleaned_keyword");

-- CreateIndex
CREATE INDEX "scraper_search_keywords_cleaned_keyword_ascii_hit_count_idx" ON "scraper_search_keywords"("cleaned_keyword_ascii", "hit_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_search_keywords_is_google_active_last_searched_at_idx" ON "scraper_search_keywords"("is_google_active", "last_searched_at");

-- CreateIndex
CREATE UNIQUE INDEX "scraper_fanpages_profile_id_key" ON "scraper_fanpages"("profile_id");

-- CreateIndex
CREATE INDEX "scraper_fanpages_profile_id_idx" ON "scraper_fanpages"("profile_id");

-- CreateIndex
CREATE INDEX "scraper_fanpages_handle_idx" ON "scraper_fanpages"("handle");

-- CreateIndex
CREATE INDEX "scraper_fanpages_is_periodic_crawl_last_scraped_at_idx" ON "scraper_fanpages"("is_periodic_crawl", "last_scraped_at");

-- CreateIndex
CREATE INDEX "scraper_fanpages_is_visible_on_ui_followers_count_idx" ON "scraper_fanpages"("is_visible_on_ui", "followers_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_fanpages_created_at_idx" ON "scraper_fanpages"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_fanpage_keywords_fanpage_id_keyword_id_key" ON "scraper_fanpage_keywords"("fanpage_id", "keyword_id");

-- CreateIndex
CREATE INDEX "scraper_fanpage_metrics_history_fanpage_id_captured_at_idx" ON "scraper_fanpage_metrics_history"("fanpage_id", "captured_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_facebook_reels_post_id_key" ON "scraper_facebook_reels"("post_id");

-- CreateIndex
CREATE UNIQUE INDEX "scraper_facebook_reels_shortcode_key" ON "scraper_facebook_reels"("shortcode");

-- CreateIndex
CREATE INDEX "scraper_facebook_reels_fanpage_id_date_posted_idx" ON "scraper_facebook_reels"("fanpage_id", "date_posted" DESC);

-- CreateIndex
CREATE INDEX "scraper_facebook_reels_views_count_idx" ON "scraper_facebook_reels"("views_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_facebook_reels_fanpage_id_views_count_idx" ON "scraper_facebook_reels"("fanpage_id", "views_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_facebook_reels_post_id_idx" ON "scraper_facebook_reels"("post_id");

-- CreateIndex
CREATE INDEX "scraper_facebook_reels_shortcode_idx" ON "scraper_facebook_reels"("shortcode");

-- CreateIndex
CREATE INDEX "scraper_reel_metrics_history_reel_id_captured_at_idx" ON "scraper_reel_metrics_history"("reel_id", "captured_at" DESC);

-- AddForeignKey
ALTER TABLE "scraper_fanpage_keywords" ADD CONSTRAINT "scraper_fanpage_keywords_fanpage_id_fkey" FOREIGN KEY ("fanpage_id") REFERENCES "scraper_fanpages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_fanpage_keywords" ADD CONSTRAINT "scraper_fanpage_keywords_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "scraper_search_keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_fanpage_metrics_history" ADD CONSTRAINT "scraper_fanpage_metrics_history_fanpage_id_fkey" FOREIGN KEY ("fanpage_id") REFERENCES "scraper_fanpages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_facebook_reels" ADD CONSTRAINT "scraper_facebook_reels_fanpage_id_fkey" FOREIGN KEY ("fanpage_id") REFERENCES "scraper_fanpages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_reel_metrics_history" ADD CONSTRAINT "scraper_reel_metrics_history_reel_id_fkey" FOREIGN KEY ("reel_id") REFERENCES "scraper_facebook_reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
