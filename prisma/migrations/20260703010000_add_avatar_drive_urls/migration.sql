-- AddColumn avatar_drive_url & header_image_drive_url to scraper + managed facebook page

ALTER TABLE "video_management_managedfacebookpage"
  ADD COLUMN IF NOT EXISTS "avatar_drive_url" TEXT;

ALTER TABLE "scraper_fanpages"
  ADD COLUMN IF NOT EXISTS "avatar_drive_url" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "header_image_drive_url" TEXT NOT NULL DEFAULT '';

ALTER TABLE "scraper_douyin_profiles"
  ADD COLUMN IF NOT EXISTS "avatar_drive_url" TEXT NOT NULL DEFAULT '';

ALTER TABLE "scraper_tiktok_profiles"
  ADD COLUMN IF NOT EXISTS "avatar_drive_url" TEXT NOT NULL DEFAULT '';

ALTER TABLE "scraper_instagram_profiles"
  ADD COLUMN IF NOT EXISTS "avatar_drive_url" TEXT NOT NULL DEFAULT '';
