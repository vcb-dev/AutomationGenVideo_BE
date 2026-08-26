-- Cột lưu ảnh tác giả sau khi đẩy lên kho, cho 5 bảng video giữ ảnh tác giả ngay trong bảng.
--
-- Năm bảng dưới đây không lấy ảnh tác giả từ bảng profile mà lưu thẳng trong bảng video
-- (author_avatar), và read service trả cột đó ra UI. Nhưng ThumbnailMigrationService chưa
-- bao giờ khai báo chúng, nên URL CDN gốc nằm nguyên đó cho tới lúc chữ ký hết hạn rồi trả
-- 403 — đo thực tế trên TikTok: 442/442 dòng author_avatar đều đã chết, ảnh tác giả trên
-- thẻ video hỏng 100%.
--
-- Dùng cột đích riêng thay vì ghi đè tại chỗ: giữ được URL gốc để còn đối chiếu, và khi cào
-- lại thì scraper cứ ghi URL mới vào author_avatar mà không đụng bản đã lưu.
--
-- Cột nullable không DEFAULT nên Postgres chỉ sửa catalog, không viết lại bảng.

ALTER TABLE "scraper_tiktok_videos"
  ADD COLUMN IF NOT EXISTS "author_avatar_drive_url" TEXT;

ALTER TABLE "scraper_douyin_videos"
  ADD COLUMN IF NOT EXISTS "author_avatar_drive_url" TEXT;

ALTER TABLE "scraper_xiaohongshu_videos"
  ADD COLUMN IF NOT EXISTS "author_avatar_drive_url" TEXT;

ALTER TABLE "scraper_kuaishou_search_videos"
  ADD COLUMN IF NOT EXISTS "author_avatar_drive_url" TEXT;

ALTER TABLE "scraper_bilibili_search_videos"
  ADD COLUMN IF NOT EXISTS "author_avatar_drive_url" TEXT;
