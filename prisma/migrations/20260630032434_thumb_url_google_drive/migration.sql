/*
  Warnings:

  - You are about to drop the `social_media_files` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "social_media_files" DROP CONSTRAINT "social_media_files_post_id_fkey";

-- AlterTable
ALTER TABLE "social_accounts" ADD COLUMN     "is_shared" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "social_drafts" ADD COLUMN     "thumb_url" TEXT;

-- AlterTable
ALTER TABLE "social_posts" ADD COLUMN     "thumb_url" TEXT;

-- AlterTable
ALTER TABLE "social_uploaded_files" ADD COLUMN     "drive_file_id" TEXT,
ADD COLUMN     "drive_web_view_url" TEXT,
ADD COLUMN     "thumbnail_drive_file_id" TEXT,
ADD COLUMN     "thumbnail_url" TEXT,
ALTER COLUMN "storage" SET DEFAULT 'google_drive';

-- DropTable
DROP TABLE "social_media_files";

-- CreateTable
CREATE TABLE "social_drive_upload_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalname" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "upload_url" TEXT NOT NULL,
    "drive_file_id" TEXT,
    "uploaded_bytes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error_msg" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_drive_upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_drive_upload_sessions_user_id_idx" ON "social_drive_upload_sessions"("user_id");

-- CreateIndex
CREATE INDEX "social_drive_upload_sessions_created_at_idx" ON "social_drive_upload_sessions"("created_at" DESC);

-- CreateIndex
CREATE INDEX "lark_kpi_report_date_idx" ON "lark_kpi"("report_date" DESC);

-- CreateIndex
CREATE INDEX "social_accounts_is_shared_idx" ON "social_accounts"("is_shared");

-- CreateIndex
CREATE INDEX "social_accounts_token_expires_at_idx" ON "social_accounts"("token_expires_at");

-- CreateIndex
CREATE INDEX "social_accounts_is_active_token_expires_at_idx" ON "social_accounts"("is_active", "token_expires_at");

-- CreateIndex
CREATE INDEX "social_posts_updated_at_idx" ON "social_posts"("updated_at");

-- CreateIndex
CREATE INDEX "social_posts_status_source_updated_at_idx" ON "social_posts"("status", "source", "updated_at");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE INDEX "users_team_idx" ON "users"("team");

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
