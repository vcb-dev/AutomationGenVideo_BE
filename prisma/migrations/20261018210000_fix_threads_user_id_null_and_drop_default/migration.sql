-- AlterTable: Drop default empty string on threads_user_id and convert existing empty strings to NULL
ALTER TABLE "scraper_threads_profiles" ALTER COLUMN "threads_user_id" DROP DEFAULT;

UPDATE "scraper_threads_profiles"
SET "threads_user_id" = NULL
WHERE "threads_user_id" = '';
