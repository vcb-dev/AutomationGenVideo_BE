-- AlterTable
ALTER TABLE "scraper_tiktok_profiles" ADD COLUMN     "sec_uid" VARCHAR(255) NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "scraper_tiktok_profiles_sec_uid_idx" ON "scraper_tiktok_profiles"("sec_uid");
