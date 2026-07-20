-- CreateTable: scraper_xiaohongshu_profiles
CREATE TABLE "scraper_xiaohongshu_profiles" (
    "id"                 BIGSERIAL PRIMARY KEY,
    "user_id"            VARCHAR(100) NOT NULL,
    "nickname"           VARCHAR(500) NOT NULL DEFAULT '',
    "avatar_url"         TEXT,
    "is_verified"        BOOLEAN NOT NULL DEFAULT FALSE,
    "is_tracked"         BOOLEAN NOT NULL DEFAULT TRUE,
    "is_bookmarked"      BOOLEAN NOT NULL DEFAULT FALSE,
    "is_initial_scraped" BOOLEAN NOT NULL DEFAULT FALSE,
    "last_scraped_at"    TIMESTAMPTZ(6),
    "scraping_status"    VARCHAR(20) NOT NULL DEFAULT 'idle',
    "scrape_error"       TEXT,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "scraper_xiaohongshu_profiles_user_id_key"
    ON "scraper_xiaohongshu_profiles"("user_id");

CREATE INDEX "scraper_xiaohongshu_profiles_is_tracked_idx"
    ON "scraper_xiaohongshu_profiles"("is_tracked");

CREATE INDEX "scraper_xiaohongshu_profiles_scraping_status_idx"
    ON "scraper_xiaohongshu_profiles"("scraping_status");

-- AddColumn: profile_id FK to scraper_xiaohongshu_videos
ALTER TABLE "scraper_xiaohongshu_videos"
    ADD COLUMN "profile_id" BIGINT;

ALTER TABLE "scraper_xiaohongshu_videos"
    ADD CONSTRAINT "scraper_xiaohongshu_videos_profile_id_fkey"
    FOREIGN KEY ("profile_id")
    REFERENCES "scraper_xiaohongshu_profiles"("id")
    ON DELETE SET NULL;

CREATE INDEX "scraper_xiaohongshu_videos_profile_id_idx"
    ON "scraper_xiaohongshu_videos"("profile_id");
