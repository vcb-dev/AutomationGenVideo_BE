-- Xiaohongshu video notes from TikHub keyword search
CREATE TABLE IF NOT EXISTS "scraper_xiaohongshu_videos" (
  "id"                  BIGSERIAL PRIMARY KEY,
  "note_id"             VARCHAR(50)    NOT NULL,
  "url"                 VARCHAR(2000)  NOT NULL,
  "title"               VARCHAR(1000)  NOT NULL DEFAULT '',
  "description"         TEXT           NOT NULL DEFAULT '',
  "thumbnail_url"       TEXT,
  "thumbnail_drive_url" TEXT,
  "author_id"           VARCHAR(100)   NOT NULL DEFAULT '',
  "author_name"         VARCHAR(500)   NOT NULL DEFAULT '',
  "author_avatar"       TEXT,
  "duration_seconds"    INTEGER        NOT NULL DEFAULT 0,
  "liked_count"         BIGINT         NOT NULL DEFAULT 0,
  "collected_count"     BIGINT         NOT NULL DEFAULT 0,
  "comments_count"      BIGINT         NOT NULL DEFAULT 0,
  "shared_count"        BIGINT         NOT NULL DEFAULT 0,
  "keywords"            TEXT[]         NOT NULL DEFAULT '{}',
  "date_posted"         TIMESTAMPTZ(6) NOT NULL,
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "scraper_xiaohongshu_videos_note_id_key"
  ON "scraper_xiaohongshu_videos"("note_id");

CREATE INDEX IF NOT EXISTS "idx_xhs_vid_likes"
  ON "scraper_xiaohongshu_videos"("liked_count" DESC);

CREATE INDEX IF NOT EXISTS "idx_xhs_vid_date"
  ON "scraper_xiaohongshu_videos"("date_posted" DESC);
