-- Dọn dẹp DB (2026-07-04):
-- 1) Drop 6 cột Lemon8/Twitter trong traffic_reports — 100% NULL trên 3.068 dòng,
--    chưa từng có ai báo cáo traffic cho 2 nền tảng này. Đã gỡ khỏi FE form + BE platform arrays.
-- 2) Drop các bảng Django bỏ hoang (0 dòng) — app AutomationGenVideo_AI đã chuyển sang DB Supabase khác.
--    Giữ lại video_management_voice vì Prisma model Voice của BE map vào bảng này.
-- LƯU Ý: giữ nguyên reported_tasks.team và kpi.task_creative — có job sync bên ngoài
--    insert với danh sách cột tường minh, drop sẽ làm gãy sync.

ALTER TABLE "traffic_reports"
  DROP COLUMN IF EXISTS "traffic_lemon8",
  DROP COLUMN IF EXISTS "channel_lemon8",
  DROP COLUMN IF EXISTS "evidence_lemon8",
  DROP COLUMN IF EXISTS "traffic_twitter",
  DROP COLUMN IF EXISTS "channel_twitter",
  DROP COLUMN IF EXISTS "evidence_twitter";

DROP TABLE IF EXISTS "auth_group_permissions" CASCADE;
DROP TABLE IF EXISTS "auth_user_groups" CASCADE;
DROP TABLE IF EXISTS "auth_user_user_permissions" CASCADE;
DROP TABLE IF EXISTS "auth_group" CASCADE;
DROP TABLE IF EXISTS "auth_permission" CASCADE;
DROP TABLE IF EXISTS "auth_user" CASCADE;
DROP TABLE IF EXISTS "django_admin_log" CASCADE;
DROP TABLE IF EXISTS "django_content_type" CASCADE;
DROP TABLE IF EXISTS "django_migrations" CASCADE;
DROP TABLE IF EXISTS "django_session" CASCADE;
DROP TABLE IF EXISTS "video_management_appuser" CASCADE;
DROP TABLE IF EXISTS "video_management_channelanalysis" CASCADE;
DROP TABLE IF EXISTS "video_management_collectionvideo" CASCADE;
DROP TABLE IF EXISTS "video_management_facebookpagecache" CASCADE;
DROP TABLE IF EXISTS "video_management_generatedcontent" CASCADE;
DROP TABLE IF EXISTS "video_management_indexedvideo" CASCADE;
DROP TABLE IF EXISTS "video_management_localvideofile" CASCADE;
DROP TABLE IF EXISTS "video_management_product" CASCADE;
DROP TABLE IF EXISTS "video_management_productlist" CASCADE;
DROP TABLE IF EXISTS "video_management_reportsettings" CASCADE;
DROP TABLE IF EXISTS "video_management_scrapedvideo" CASCADE;
DROP TABLE IF EXISTS "video_management_searchhistory" CASCADE;
DROP TABLE IF EXISTS "video_management_searchquery" CASCADE;
DROP TABLE IF EXISTS "video_management_tiktokusercache" CASCADE;
DROP TABLE IF EXISTS "video_management_trackedchannel" CASCADE;
DROP TABLE IF EXISTS "video_management_trendingkeyword" CASCADE;
DROP TABLE IF EXISTS "video_management_videoclipcache" CASCADE;
DROP TABLE IF EXISTS "video_management_videocollection" CASCADE;
