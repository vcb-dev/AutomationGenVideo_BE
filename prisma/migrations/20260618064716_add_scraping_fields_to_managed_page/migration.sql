-- AlterTable
ALTER TABLE "video_management_managedfacebookpage" ADD COLUMN     "is_scraping" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_scraped_at" TIMESTAMPTZ(6),
ADD COLUMN     "scrape_error" TEXT;

-- CreateIndex
CREATE INDEX "video_management_managedfacebookpage_is_active_is_scraping_idx" ON "video_management_managedfacebookpage"("is_active", "is_scraping");
