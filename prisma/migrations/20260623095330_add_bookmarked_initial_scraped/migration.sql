-- AlterTable
ALTER TABLE "scraper_fanpages" ADD COLUMN     "is_bookmarked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_initial_scraped" BOOLEAN NOT NULL DEFAULT false;
