-- Phase 2 của lộ trình "đẩy filter search (q) xuống DB, có index" — thí điểm
-- trên Facebook owned pages (bảng đã audit chi tiết) trước khi nhân rộng.
--
-- Dùng immutable_unaccent() (Phase 1, migration 20260716000000) làm index
-- expression — cho phép WHERE lower(immutable_unaccent(col)) ILIKE '%...%'
-- chạy qua GIN trigram thay vì full table scan.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- video_management_managedfacebookpage.name — search theo tên Page
-- (FacebookOwnedPagesReadService::getManagedPages)
CREATE INDEX IF NOT EXISTS "managed_facebook_page_name_trgm"
  ON "video_management_managedfacebookpage"
  USING gin (lower(immutable_unaccent(name)) gin_trgm_ops);

-- video_management_ownedvideocontent.caption — search theo caption video
-- (FacebookOwnedPagesReadService::getSyncedVideos)
CREATE INDEX IF NOT EXISTS "owned_video_content_caption_trgm"
  ON "video_management_ownedvideocontent"
  USING gin (lower(immutable_unaccent(caption)) gin_trgm_ops);
