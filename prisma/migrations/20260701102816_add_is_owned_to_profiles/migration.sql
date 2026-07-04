/*
  Warnings:

  - A unique constraint covering the columns `[instagram_id]` on the table `scraper_instagram_profiles` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "scraper_xiaohongshu_videos" DROP CONSTRAINT "scraper_xiaohongshu_videos_profile_id_fkey";

-- AlterTable
ALTER TABLE "scraper_douyin_profiles" ADD COLUMN     "is_owned" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "scraper_instagram_profiles" ADD COLUMN     "is_owned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "scraper_tiktok_profiles" ADD COLUMN     "is_owned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "scraper_xiaohongshu_profiles" ADD COLUMN     "is_owned" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "scraper_xiaohongshu_videos" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "scraper_douyin_profiles_is_owned_idx" ON "scraper_douyin_profiles"("is_owned");

-- CreateIndex
CREATE INDEX "scraper_instagram_profiles_is_owned_idx" ON "scraper_instagram_profiles"("is_owned");

-- CreateIndex
CREATE INDEX "scraper_tiktok_profiles_is_owned_idx" ON "scraper_tiktok_profiles"("is_owned");

-- CreateIndex
CREATE INDEX "scraper_xiaohongshu_profiles_is_owned_idx" ON "scraper_xiaohongshu_profiles"("is_owned");

-- AddForeignKey
ALTER TABLE "scraper_xiaohongshu_videos" ADD CONSTRAINT "scraper_xiaohongshu_videos_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_xiaohongshu_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "scraper_douyin_profiles_bookmarked_idx" RENAME TO "scraper_douyin_profiles_is_bookmarked_idx";

-- RenameIndex
ALTER INDEX "scraper_douyin_profiles_followers_idx" RENAME TO "scraper_douyin_profiles_followers_count_idx";

-- RenameIndex
ALTER INDEX "scraper_douyin_profiles_tracked_idx" RENAME TO "scraper_douyin_profiles_is_tracked_last_scraped_at_idx";

-- RenameIndex
ALTER INDEX "idx_xhs_vid_date" RENAME TO "scraper_xiaohongshu_videos_date_posted_idx";

-- RenameIndex
ALTER INDEX "idx_xhs_vid_likes" RENAME TO "scraper_xiaohongshu_videos_liked_count_idx";
