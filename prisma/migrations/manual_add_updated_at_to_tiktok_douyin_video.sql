-- AlterTable
ALTER TABLE "scraper_tiktok_videos" ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

-- AlterTable
ALTER TABLE "scraper_douyin_videos" ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();
