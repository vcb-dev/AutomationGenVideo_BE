-- Giữ lại URL CDN gốc cho 5 bảng có thumbnail bị ghi đè tại chỗ.
--
-- ThumbnailMigrationService đẩy ảnh lên Cloudinary rồi ghi URL mới vào DB. Với 13 target
-- thì URL mới nằm ở cột đích riêng (avatar_drive_url/thumbnail_drive_url), cột nguồn còn
-- nguyên. Nhưng 5 bảng dưới đây không có cột đích riêng nên URL Cloudinary ghi ĐÈ THẲNG
-- lên cột nguồn — URL CDN gốc mất vĩnh viễn ngay lần upload đầu.
--
-- Vì sao mất là nghiêm trọng: Cloudinary đang chạy gói Free, asset có thể bị xoá; và nếu
-- upload sai ảnh (đã xảy ra thật với hai bảng TikTok dùng trùng public_id) thì không còn
-- đường khôi phục. Cào lại cũng không cứu được vì isHostedThumbnailUrl giữ nguyên URL kho,
-- cố tình không cho scraper ghi đè.
--
-- Cột mới nullable và không có DEFAULT nên Postgres chỉ sửa catalog, không viết lại bảng —
-- an toàn với dữ liệu sẵn có, không khoá bảng lâu.
--
-- Dòng đã migrate TRƯỚC migration này thì bản gốc đã mất rồi, cột mới sẽ để NULL. Migration
-- chỉ chặn thiệt hại từ đây trở đi.

ALTER TABLE "scraper_douyin_videos"
  ADD COLUMN IF NOT EXISTS "preview_image_original_url" TEXT;

ALTER TABLE "scraper_tiktok_videos"
  ADD COLUMN IF NOT EXISTS "preview_image_original_url" TEXT;

ALTER TABLE "scraper_tiktok_profile_videos"
  ADD COLUMN IF NOT EXISTS "cover_image_original_url" TEXT;

ALTER TABLE "scraper_kuaishou_search_videos"
  ADD COLUMN IF NOT EXISTS "thumbnail_original_url" TEXT;

ALTER TABLE "scraper_bilibili_search_videos"
  ADD COLUMN IF NOT EXISTS "thumbnail_original_url" TEXT;
