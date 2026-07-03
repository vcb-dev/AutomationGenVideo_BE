-- Add thumbnail_drive_url to store permanent Google Drive URL for Instagram reel thumbnails
ALTER TABLE "scraper_instagram_reels"
  ADD COLUMN IF NOT EXISTS "thumbnail_drive_url" TEXT;
