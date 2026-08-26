-- Dọn hậu quả trùng public_id giữa hai bảng TikTok.
--
-- ĐÂY LÀ FILE THỦ CÔNG — đặt tên manual_* nên CI KHÔNG bao giờ tự chạy. Phải tự chạy tay
-- sau khi đã xem kết quả bước 1.
--
-- Nguyên nhân: scraper_tiktok_videos và scraper_tiktok_profile_videos từng dùng chung
-- filenamePrefix 'tiktok' trong cùng folder Cloudinary 'vcb-thumbnails/tiktok'. Id của hai
-- bảng là hai chuỗi autoincrement độc lập nên trùng nhau, mà upload dùng overwrite: true —
-- ảnh lên sau đè ảnh lên trước và cả hai bản ghi cùng trỏ vào một ảnh.
--
-- Cả hai cột đều là target ghi đè tại chỗ (inPlace) nên URL CDN gốc đã mất, không khôi phục
-- được từ DB. Cách duy nhất là xoá URL sai đi rồi để scraper cào lại lấy URL CDN mới.
--
-- Code đã sửa (prefix bảng thứ hai đổi thành 'tiktok-profile') nên sự cố không tái diễn,
-- nhưng dòng cũ thì không tự khỏi: điều kiện lọc của migration bỏ qua URL đã là cloudinary,
-- và isHostedThumbnailUrl giờ giữ URL Cloudinary nên cào lại cũng không ghi đè.


-- ── Bước 1: ĐẾM TRƯỚC. Chạy riêng, xem con số rồi mới quyết định. ────────────────────

SELECT
  (SELECT COUNT(*) FROM scraper_tiktok_profile_videos
     WHERE cover_image LIKE '%/vcb-thumbnails/tiktok/tiktok-%')      AS profile_videos_nghi_sai,
  (SELECT COUNT(*) FROM scraper_tiktok_videos
     WHERE preview_image LIKE '%/vcb-thumbnails/tiktok/tiktok-%')    AS videos_dung_chung_folder,
  -- Số thật sự đụng nhau: cùng id nên cùng public_id.
  (SELECT COUNT(*) FROM scraper_tiktok_profile_videos pv
     WHERE pv.cover_image LIKE '%/vcb-thumbnails/tiktok/tiktok-%'
       AND EXISTS (SELECT 1 FROM scraper_tiktok_videos v
                    WHERE v.id = pv.id
                      AND v.preview_image LIKE '%/vcb-thumbnails/tiktok/tiktok-%')) AS thuc_su_trung;


-- ── Bước 2: xem thử vài dòng cho chắc trước khi sửa ──────────────────────────────────

SELECT pv.id, pv.cover_image AS anh_cua_profile_video, v.preview_image AS anh_cua_video
FROM scraper_tiktok_profile_videos pv
JOIN scraper_tiktok_videos v ON v.id = pv.id
WHERE pv.cover_image LIKE '%/vcb-thumbnails/tiktok/tiktok-%'
  AND v.preview_image LIKE '%/vcb-thumbnails/tiktok/tiktok-%'
LIMIT 20;
-- Hai cột phải ra CÙNG một URL — đó chính là bằng chứng trùng.


-- ── Bước 3: dọn. Chỉ chạy sau khi bước 1 và 2 cho kết quả như mong đợi. ──────────────
--
-- Chỉ đụng scraper_tiktok_profile_videos (bảng bị đổi prefix), KHÔNG đụng
-- scraper_tiktok_videos — bảng đó giữ nguyên prefix 'tiktok' nên ảnh của nó vẫn đúng
-- địa chỉ. Xoá cả hai thì mất luôn ảnh đang dùng được.
--
-- Sau khi chạy, cover_image = NULL. Lần cào kênh kế tiếp sẽ ghi URL CDN mới vào, rồi
-- ThumbnailMigrationService đẩy lên Cloudinary với public_id mới 'tiktok-profile-<id>'.
-- Trong lúc chờ, giao diện hiển thị ảnh trống ở những video đó.

BEGIN;

UPDATE scraper_tiktok_profile_videos
SET cover_image = NULL
WHERE cover_image LIKE '%/vcb-thumbnails/tiktok/tiktok-%';

-- Xem số dòng vừa đổi có khớp bước 1 không. Lệch thì ROLLBACK.
COMMIT;
