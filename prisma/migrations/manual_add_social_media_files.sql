-- Bảng lưu binary video/ảnh sau khi đăng mạng xã hội xong
-- Thay thế việc lưu vào Google Drive / thư mục local

CREATE TABLE IF NOT EXISTS social_media_files (
  id          TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  post_id     TEXT,
  filename    TEXT        NOT NULL UNIQUE,
  mimetype    TEXT        NOT NULL DEFAULT 'video/mp4',
  size        INTEGER     NOT NULL,
  data        BYTEA       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_social_media_files_post
    FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_social_media_files_post_id  ON social_media_files(post_id);
CREATE INDEX IF NOT EXISTS idx_social_media_files_filename ON social_media_files(filename);
