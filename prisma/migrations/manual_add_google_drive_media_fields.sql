CREATE TABLE IF NOT EXISTS "social_uploaded_files" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "originalname" TEXT NOT NULL,
  "mimetype" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "url" TEXT NOT NULL,
  "thumbnail_url" TEXT,
  "storage" TEXT NOT NULL DEFAULT 'google_drive',
  "drive_file_id" TEXT,
  "drive_web_view_url" TEXT,
  "thumbnail_drive_file_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "social_uploaded_files"
  ADD COLUMN IF NOT EXISTS "drive_file_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drive_web_view_url" TEXT,
  ADD COLUMN IF NOT EXISTS "thumbnail_drive_file_id" TEXT;

ALTER TABLE "social_uploaded_files"
  ALTER COLUMN "storage" SET DEFAULT 'google_drive';

CREATE INDEX IF NOT EXISTS "social_uploaded_files_drive_file_id_idx"
  ON "social_uploaded_files"("drive_file_id");

CREATE INDEX IF NOT EXISTS "social_uploaded_files_user_id_idx"
  ON "social_uploaded_files"("user_id");

CREATE INDEX IF NOT EXISTS "social_uploaded_files_created_at_idx"
  ON "social_uploaded_files"("created_at" DESC);

CREATE TABLE IF NOT EXISTS "social_drive_upload_sessions" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "originalname" TEXT NOT NULL DEFAULT '',
  "mimetype" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "upload_url" TEXT NOT NULL,
  "drive_file_id" TEXT,
  "uploaded_bytes" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "error_msg" TEXT,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "social_drive_upload_sessions_user_id_idx"
  ON "social_drive_upload_sessions"("user_id");

CREATE INDEX IF NOT EXISTS "social_drive_upload_sessions_created_at_idx"
  ON "social_drive_upload_sessions"("created_at" DESC);

ALTER TABLE "social_drive_upload_sessions"
  ADD COLUMN IF NOT EXISTS "originalname" TEXT NOT NULL DEFAULT '';

ALTER TABLE "social_drive_upload_sessions"
  ADD COLUMN IF NOT EXISTS "uploaded_bytes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "error_msg" TEXT,
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3);
