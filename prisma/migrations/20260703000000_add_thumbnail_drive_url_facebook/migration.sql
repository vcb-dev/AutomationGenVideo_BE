ALTER TABLE "scraper_facebook_reels" ADD COLUMN IF NOT EXISTS "thumbnail_drive_url" TEXT NOT NULL DEFAULT '';
ALTER TABLE "video_management_ownedvideocontent" ADD COLUMN IF NOT EXISTS "thumbnail_drive_url" TEXT;
