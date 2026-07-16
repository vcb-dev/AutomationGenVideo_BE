-- Partial index cho cron ThumbnailMigrationService (chạy mỗi phút).
-- Trước đây mỗi lần cron quét là seq-scan nguyên bảng ownedvideocontent (115MB,
-- ~1.2s/lần, chiếm 4+ giờ DB time trong pg_stat_statements) dù chỉ còn vài dòng
-- chưa migrate. Partial index chỉ chứa đúng các dòng PENDING (predicate khớp
-- nguyên văn WHERE của cron) → dòng nào migrate xong tự rời khỏi index, query
-- còn ~0.04ms (đã đo EXPLAIN ANALYZE trên DB thật 2026-07-16).
--
-- ĐÃ ÁP LÊN DB THẬT (wbium…) ngày 2026-07-16 từ máy user.
-- Lưu ý khi chạy lại: CONCURRENTLY không chạy được trong transaction —
-- chạy qua kết nối session (port 5432), autocommit, KHÔNG bọc BEGIN/COMMIT.

CREATE INDEX CONCURRENTLY IF NOT EXISTS ovc_thumb_pending_pidx
ON public.video_management_ownedvideocontent (id DESC)
WHERE thumbnail_url IS NOT NULL AND thumbnail_url <> ''
  AND (thumbnail_drive_url IS NULL OR thumbnail_drive_url = '');

CREATE INDEX CONCURRENTLY IF NOT EXISTS mfp_avatar_pending_pidx
ON public.video_management_managedfacebookpage (id DESC)
WHERE avatar_url IS NOT NULL AND avatar_url <> ''
  AND (avatar_drive_url IS NULL OR avatar_drive_url = '');
