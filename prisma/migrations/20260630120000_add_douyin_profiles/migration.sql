-- CreateTable: scraper_douyin_profiles
CREATE TABLE "scraper_douyin_profiles" (
    "id"                 BIGSERIAL PRIMARY KEY,
    "sec_user_id"        VARCHAR(255)  NOT NULL,
    "uid"                VARCHAR(50)   NOT NULL DEFAULT '',
    "username"           VARCHAR(255)  NOT NULL DEFAULT '',
    "nickname"           VARCHAR(500)  NOT NULL DEFAULT '',
    "avatar_url"         TEXT          NOT NULL DEFAULT '',
    "biography"          TEXT          NOT NULL DEFAULT '',
    "is_verified"        BOOLEAN       NOT NULL DEFAULT false,
    "followers_count"    BIGINT        NOT NULL DEFAULT 0,
    "following_count"    BIGINT        NOT NULL DEFAULT 0,
    "likes_count"        BIGINT        NOT NULL DEFAULT 0,
    "videos_count"       INTEGER       NOT NULL DEFAULT 0,
    "is_bookmarked"      BOOLEAN       NOT NULL DEFAULT false,
    "is_tracked"         BOOLEAN       NOT NULL DEFAULT false,
    "is_initial_scraped" BOOLEAN       NOT NULL DEFAULT false,
    "last_scraped_at"    TIMESTAMPTZ,
    "scraping_status"    VARCHAR(20)   NOT NULL DEFAULT 'idle',
    "scrape_error"       TEXT,
    "created_at"         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    "updated_at"         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "scraper_douyin_profiles_sec_user_id_key" ON "scraper_douyin_profiles"("sec_user_id");
CREATE INDEX "scraper_douyin_profiles_uid_idx"           ON "scraper_douyin_profiles"("uid");
CREATE INDEX "scraper_douyin_profiles_username_idx"      ON "scraper_douyin_profiles"("username");
CREATE INDEX "scraper_douyin_profiles_tracked_idx"       ON "scraper_douyin_profiles"("is_tracked", "last_scraped_at");
CREATE INDEX "scraper_douyin_profiles_bookmarked_idx"    ON "scraper_douyin_profiles"("is_bookmarked");
CREATE INDEX "scraper_douyin_profiles_followers_idx"     ON "scraper_douyin_profiles"("followers_count" DESC);
