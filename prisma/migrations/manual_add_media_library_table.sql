-- Thủ công thêm bảng social_uploaded_files cho Media Library
-- Chạy lệnh: psql $DATABASE_URL < prisma/migrations/manual_add_media_library_table.sql

CREATE TABLE IF NOT EXISTS "social_uploaded_files" (
    "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id"      TEXT NOT NULL,
    "filename"     TEXT NOT NULL,
    "originalname" TEXT NOT NULL,
    "mimetype"     TEXT NOT NULL,
    "size"         INTEGER NOT NULL,
    "url"          TEXT NOT NULL,
    "storage"      TEXT NOT NULL DEFAULT 'supabase',
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "social_uploaded_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "social_uploaded_files_user_id_idx" ON "social_uploaded_files"("user_id");
CREATE INDEX IF NOT EXISTS "social_uploaded_files_created_at_idx" ON "social_uploaded_files"("created_at" DESC);
