-- Remove is_google_active: orphaned end-to-end — never surfaced/toggled in FE,
-- and its only consumer (bulk "discover all active keywords" task) was never
-- registered in Celery Beat and never called from FE. Removing field + task together.

-- DropIndex
DROP INDEX "scraper_search_keywords_is_google_active_last_searched_at_idx";

-- AlterTable
ALTER TABLE "scraper_search_keywords" DROP COLUMN "is_google_active";
