-- Vá lệch schema bảng Threads.
--
-- Bối cảnh: hai bảng này trước đây chỉ được định nghĩa trong
-- `prisma/migrations/manual_add_threads_scraper_tables.sql`. CI chỉ áp các migration dạng
-- `<timestamp>_.../migration.sql`, nên production không bao giờ nhận được định nghĩa đó và
-- `/api/scraper/threads/owned/profiles` trả 500:
--
--     The column `scraper_threads_profiles.url` does not exist in the current database.
--
-- Vì sao chạy lại file manual không cứu được: nó dùng `CREATE TABLE IF NOT EXISTS`, mà bảng
-- trên production ĐÃ tồn tại (chỉ thiếu cột) nên câu lệnh trở thành lệnh rỗng.
--
-- Migration này chạy được trên cả hai loại môi trường:
--   - DB mới tinh        → khối CREATE TABLE dựng đủ bảng.
--   - DB đã lệch (prod)  → khối ADD COLUMN IF NOT EXISTS bù đúng những cột còn thiếu.
-- Mọi câu lệnh đều idempotent, chạy lại nhiều lần không hỏng.

-- ────────────────────────────────────────────────────────────────────────────
-- scraper_threads_profiles
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "scraper_threads_profiles" (
    "id"               BIGSERIAL     NOT NULL,
    "threads_user_id"  VARCHAR(100),
    "username"         VARCHAR(255)  NOT NULL,
    "name"             VARCHAR(500)  DEFAULT '',
    "url"              VARCHAR(1000) NOT NULL DEFAULT '',
    "avatar_url"       TEXT,
    "avatar_drive_url" TEXT          NOT NULL DEFAULT '',
    "biography"        TEXT          DEFAULT '',
    "followers_count"  BIGINT        NOT NULL DEFAULT 0,
    "is_verified"      BOOLEAN       NOT NULL DEFAULT false,
    "is_tracked"       BOOLEAN       NOT NULL DEFAULT false,
    "is_bookmarked"    BOOLEAN       NOT NULL DEFAULT false,
    "is_owned"         BOOLEAN       NOT NULL DEFAULT true,
    "last_scraped_at"  TIMESTAMPTZ(6),
    "scraping_status"  VARCHAR(20)   NOT NULL DEFAULT 'idle',
    "scrape_error"     TEXT,
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_threads_profiles_pkey" PRIMARY KEY ("id")
);

-- Bù cột cho DB đã tồn tại bảng nhưng thiếu cột (chính là tình trạng production).
ALTER TABLE "scraper_threads_profiles"
    ADD COLUMN IF NOT EXISTS "threads_user_id"  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS "name"             VARCHAR(500)  DEFAULT '',
    ADD COLUMN IF NOT EXISTS "url"              VARCHAR(1000) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "avatar_url"       TEXT,
    ADD COLUMN IF NOT EXISTS "avatar_drive_url" TEXT          NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "biography"        TEXT          DEFAULT '',
    ADD COLUMN IF NOT EXISTS "followers_count"  BIGINT        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "is_verified"      BOOLEAN       NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "is_tracked"       BOOLEAN       NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "is_bookmarked"    BOOLEAN       NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "is_owned"         BOOLEAN       NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "last_scraped_at"  TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "scraping_status"  VARCHAR(20)   NOT NULL DEFAULT 'idle',
    ADD COLUMN IF NOT EXISTS "scrape_error"     TEXT,
    ADD COLUMN IF NOT EXISTS "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "scraper_threads_profiles_username_key"
    ON "scraper_threads_profiles"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "scraper_threads_profiles_threads_user_id_key"
    ON "scraper_threads_profiles"("threads_user_id");
CREATE INDEX IF NOT EXISTS "scraper_threads_profiles_username_idx"
    ON "scraper_threads_profiles"("username");
CREATE INDEX IF NOT EXISTS "scraper_threads_profiles_is_tracked_last_scraped_at_idx"
    ON "scraper_threads_profiles"("is_tracked", "last_scraped_at");
CREATE INDEX IF NOT EXISTS "scraper_threads_profiles_is_owned_idx"
    ON "scraper_threads_profiles"("is_owned");
CREATE INDEX IF NOT EXISTS "scraper_threads_profiles_followers_count_idx"
    ON "scraper_threads_profiles"("followers_count" DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- scraper_threads_posts
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "scraper_threads_posts" (
    "id"                  BIGSERIAL     NOT NULL,
    "profile_id"          BIGINT        NOT NULL,
    "post_id"             VARCHAR(100)  NOT NULL,
    "shortcode"           VARCHAR(100),
    "url"                 VARCHAR(1000) NOT NULL DEFAULT '',
    "text"                TEXT          NOT NULL DEFAULT '',
    "hashtags"            TEXT[]        NOT NULL DEFAULT '{}',
    "thumbnail_url"       TEXT,
    "thumbnail_drive_url" TEXT,
    "media_type"          VARCHAR(50)   DEFAULT 'TEXT',
    "views_count"         BIGINT        NOT NULL DEFAULT 0,
    "likes_count"         BIGINT        NOT NULL DEFAULT 0,
    "replies_count"       BIGINT        NOT NULL DEFAULT 0,
    "reposts_count"       BIGINT        NOT NULL DEFAULT 0,
    "quotes_count"        BIGINT        NOT NULL DEFAULT 0,
    "date_posted"         TIMESTAMPTZ(6) NOT NULL,
    "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_threads_posts_pkey" PRIMARY KEY ("id")
);

-- `date_posted` trong schema là NOT NULL không default. Thêm cột NOT NULL không default vào
-- bảng đã có dữ liệu sẽ lỗi, nên ở nhánh bù cột phải kèm DEFAULT. Cột này gần như chắc chắn
-- đã tồn tại (service vẫn ghi bài được), nên đây chỉ là lưới an toàn.
ALTER TABLE "scraper_threads_posts"
    ADD COLUMN IF NOT EXISTS "shortcode"           VARCHAR(100),
    ADD COLUMN IF NOT EXISTS "url"                 VARCHAR(1000) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "text"                TEXT          NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "hashtags"            TEXT[]        NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "thumbnail_url"       TEXT,
    ADD COLUMN IF NOT EXISTS "thumbnail_drive_url" TEXT,
    ADD COLUMN IF NOT EXISTS "media_type"          VARCHAR(50)   DEFAULT 'TEXT',
    ADD COLUMN IF NOT EXISTS "views_count"         BIGINT        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "likes_count"         BIGINT        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "replies_count"       BIGINT        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "reposts_count"       BIGINT        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "quotes_count"        BIGINT        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "date_posted"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "scraper_threads_posts_post_id_key"
    ON "scraper_threads_posts"("post_id");
CREATE INDEX IF NOT EXISTS "scraper_threads_posts_profile_id_idx"
    ON "scraper_threads_posts"("profile_id");
CREATE INDEX IF NOT EXISTS "scraper_threads_posts_date_posted_idx"
    ON "scraper_threads_posts"("date_posted" DESC);

-- Khoá ngoại: chỉ tạo nếu chưa có (ADD CONSTRAINT không hỗ trợ IF NOT EXISTS).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'scraper_threads_posts_profile_id_fkey'
    ) THEN
        ALTER TABLE "scraper_threads_posts"
            ADD CONSTRAINT "scraper_threads_posts_profile_id_fkey"
            FOREIGN KEY ("profile_id") REFERENCES "scraper_threads_profiles"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
