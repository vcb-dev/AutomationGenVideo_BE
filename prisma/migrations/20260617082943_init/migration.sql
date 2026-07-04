-- CreateEnum
CREATE TYPE "CollectionType" AS ENUM ('TEAM', 'SHARED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'MEMBER', 'LEADER');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('TIKTOK', 'INSTAGRAM', 'FACEBOOK', 'DOUYIN', 'XIAOHONGSHU', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('UNIQUE', 'DUPLICATE', 'PENDING_REVIEW', 'SUSPICIOUS');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'THREADS', 'YOUTUBE', 'ZALO');

-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SocialPostSource" AS ENUM ('IMMEDIATE', 'SCHEDULED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "full_name" TEXT NOT NULL,
    "google_id" TEXT,
    "manager_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "custom_permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lark_permissions" JSONB,
    "last_app_update_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "roles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[],
    "team" TEXT,
    "team_leader_id" TEXT,
    "lark_employee_record_id" TEXT,
    "employee_id" TEXT,
    "image_url" TEXT,
    "employee_data" JSONB,
    "employee_position" TEXT,
    "employee_status" TEXT,
    "employee_date" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "menu_ids" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_channels" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "total_followers" INTEGER,
    "total_likes" BIGINT NOT NULL DEFAULT 0,
    "total_views" BIGINT NOT NULL DEFAULT 0,
    "total_videos" INTEGER NOT NULL DEFAULT 0,
    "engagement_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "initial_video_count" INTEGER NOT NULL DEFAULT 0,
    "posts_count" INTEGER,
    "added_via" TEXT NOT NULL DEFAULT 'manual',
    "lark_channel_id" TEXT,

    CONSTRAINT "tracked_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_voice" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "voice_id" VARCHAR(255) NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'heygen',
    "is_cloned" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "language" VARCHAR(10) NOT NULL DEFAULT 'vi',
    "gender" VARCHAR(20),
    "sample_audio_url" TEXT,
    "source_video_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "video_management_voice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "videos" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "thumbnail_url" TEXT,
    "duration" INTEGER,
    "content_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "file_url" TEXT,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_posts" (
    "id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platform_video_id" TEXT,
    "platform_url" TEXT,
    "title" TEXT,
    "description" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "views" BIGINT NOT NULL DEFAULT 0,
    "likes" BIGINT NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_fingerprints" (
    "id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "feature_vector" DOUBLE PRECISION[],
    "perceptual_hash" TEXT,
    "keyframe_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duration_seconds" INTEGER NOT NULL,
    "frame_count" INTEGER,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_groups" (
    "id" TEXT NOT NULL,
    "master_video_id" TEXT NOT NULL,
    "production_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_duplicates" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "status" "DuplicateStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "is_master" BOOLEAN NOT NULL DEFAULT false,
    "similarity_score" DOUBLE PRECISION,
    "detection_method" TEXT,
    "confidence_level" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_duplicates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_group" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,

    CONSTRAINT "auth_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_group_permissions" (
    "id" BIGSERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "auth_group_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_permission" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "content_type_id" INTEGER NOT NULL,
    "codename" VARCHAR(100) NOT NULL,

    CONSTRAINT "auth_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_user" (
    "id" SERIAL NOT NULL,
    "password" VARCHAR(128) NOT NULL,
    "last_login" TIMESTAMPTZ(6),
    "is_superuser" BOOLEAN NOT NULL,
    "username" VARCHAR(150) NOT NULL,
    "first_name" VARCHAR(150) NOT NULL,
    "last_name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "is_staff" BOOLEAN NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "date_joined" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_user_groups" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,

    CONSTRAINT "auth_user_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_user_user_permissions" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "auth_user_user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "django_admin_log" (
    "id" SERIAL NOT NULL,
    "action_time" TIMESTAMPTZ(6) NOT NULL,
    "object_id" TEXT,
    "object_repr" VARCHAR(200) NOT NULL,
    "action_flag" SMALLINT NOT NULL,
    "change_message" TEXT NOT NULL,
    "content_type_id" INTEGER,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "django_admin_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "django_content_type" (
    "id" SERIAL NOT NULL,
    "app_label" VARCHAR(100) NOT NULL,
    "model" VARCHAR(100) NOT NULL,

    CONSTRAINT "django_content_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "django_migrations" (
    "id" BIGSERIAL NOT NULL,
    "app" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "applied" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "django_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "django_session" (
    "session_key" VARCHAR(40) NOT NULL,
    "session_data" TEXT NOT NULL,
    "expire_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "django_session_pkey" PRIMARY KEY ("session_key")
);

-- CreateTable
CREATE TABLE "video_management_collectionvideo" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "video_id" BIGINT NOT NULL,
    "collection_id" BIGINT NOT NULL,

    CONSTRAINT "video_management_collectionvideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_scrapedvideo" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "video_id" VARCHAR(255) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "author_username" VARCHAR(255) NOT NULL,
    "author_name" VARCHAR(255) NOT NULL,
    "likes_count" BIGINT NOT NULL,
    "views_count" BIGINT NOT NULL,
    "comments_count" BIGINT NOT NULL,
    "shares_count" BIGINT NOT NULL,
    "video_url" VARCHAR(1000) NOT NULL,
    "download_url" VARCHAR(1000) NOT NULL,
    "thumbnail_url" VARCHAR(1000) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "hashtags" JSONB NOT NULL,
    "music_info" JSONB NOT NULL,
    "raw_data" JSONB NOT NULL,
    "search_history_id" BIGINT,
    "duration" DOUBLE PRECISION NOT NULL,
    "feature_vector" BYTEA,

    CONSTRAINT "video_management_scrapedvideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_searchhistory" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "keyword" VARCHAR(500) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "min_likes" INTEGER NOT NULL,
    "min_views" INTEGER NOT NULL,
    "max_results" INTEGER NOT NULL,
    "results_count" INTEGER NOT NULL,
    "raw_results" JSONB NOT NULL,
    "task_id" VARCHAR(255),
    "error_message" TEXT,
    "execution_time" DOUBLE PRECISION NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "search_mode" VARCHAR(20) NOT NULL DEFAULT 'hashtag',

    CONSTRAINT "video_management_searchhistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_trackedchannel" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "channel_id" VARCHAR(255) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "check_interval_minutes" INTEGER NOT NULL,
    "min_likes_threshold" INTEGER NOT NULL,
    "last_checked_at" TIMESTAMPTZ(6),
    "follower_count" BIGINT NOT NULL,

    CONSTRAINT "video_management_trackedchannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_videocollection" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "color" VARCHAR(7) NOT NULL,

    CONSTRAINT "video_management_videocollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_histories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "platform" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lark_reports" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "team" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "answers" JSONB,
    "date" TIMESTAMP(3),
    "email" TEXT,
    "employee" JSONB,
    "role" TEXT,

    CONSTRAINT "lark_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lark_kpi" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT,
    "name" TEXT,
    "tag" TEXT,
    "team" TEXT,
    "image_url" TEXT,
    "kpi_day" INTEGER,
    "kpi_month" INTEGER,
    "kpii_status" TEXT,
    "kpi_day_percent" TEXT,
    "completed_day" INTEGER,
    "completed_month" INTEGER,
    "task_new" INTEGER,
    "task_new_month" INTEGER,
    "task_auto" INTEGER,
    "task_auto_month" INTEGER,
    "task_creative" INTEGER,
    "content_win_new" INTEGER,
    "revenue_month" BIGINT,
    "traffic_month" BIGINT,
    "target_revenue_month" TEXT,
    "target_traffic_month" TEXT,
    "kpi_progress_month" DOUBLE PRECISION,
    "employee_status" TEXT,
    "state" TEXT,
    "employee_data" JSONB,
    "report_date" TIMESTAMP(3),
    "month" TEXT,
    "link_image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lark_kpi_do_da" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT,
    "name" TEXT,
    "tag" TEXT,
    "team" TEXT,
    "image_url" TEXT,
    "kpi_day" INTEGER,
    "kpi_month" INTEGER,
    "kpii_status" TEXT,
    "kpi_day_percent" TEXT,
    "completed_day" INTEGER,
    "completed_month" INTEGER,
    "task_new" INTEGER,
    "task_new_month" INTEGER,
    "task_auto" INTEGER,
    "task_auto_month" INTEGER,
    "task_creative" INTEGER,
    "content_win_new" INTEGER,
    "revenue_month" BIGINT,
    "traffic_month" BIGINT,
    "target_revenue_month" TEXT,
    "target_traffic_month" TEXT,
    "kpi_progress_month" DOUBLE PRECISION,
    "employee_status" TEXT,
    "state" TEXT,
    "employee_data" JSONB,
    "report_date" TIMESTAMP(3),
    "month" TEXT,
    "link_image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_kpi_do_da_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lark_kpi_do_da_editor" (
    "id" TEXT NOT NULL,
    "editor_name" TEXT NOT NULL,
    "editor_name_key" TEXT,
    "team" TEXT,
    "report_date" TIMESTAMP(3) NOT NULL,
    "report_date_key" TEXT NOT NULL,
    "month" TEXT,
    "kpi_day" INTEGER NOT NULL DEFAULT 0,
    "completed_day" INTEGER NOT NULL DEFAULT 0,
    "kpi_month" INTEGER NOT NULL DEFAULT 0,
    "completed_month" INTEGER NOT NULL DEFAULT 0,
    "source_table_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_kpi_do_da_editor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lark_traffic" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "employee" JSONB,
    "team" TEXT,
    "month" TEXT,
    "traffic_fb" BIGINT,
    "traffic_ig" BIGINT,
    "traffic_lemon8" BIGINT,
    "traffic_thread" BIGINT,
    "traffic_tiktok" BIGINT,
    "traffic_yt" BIGINT,
    "traffic_zalo" BIGINT,
    "total_traffic" BIGINT,
    "is_confirmed" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "evidence_files" TEXT,
    "traffic_twitter" BIGINT,
    "email" TEXT,
    "evidence_fb" TEXT,
    "evidence_ig" TEXT,
    "evidence_tiktok" TEXT,
    "evidence_yt" TEXT,
    "evidence_thread" TEXT,
    "evidence_lemon8" TEXT,
    "evidence_zalo" TEXT,
    "evidence_twitter" TEXT,
    "channel_fb" TEXT,
    "channel_ig" TEXT,
    "channel_tiktok" TEXT,
    "channel_yt" TEXT,
    "channel_thread" TEXT,
    "channel_lemon8" TEXT,
    "channel_zalo" TEXT,
    "channel_twitter" TEXT,

    CONSTRAINT "lark_traffic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_outstanding" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "date" TEXT,
    "team" TEXT,
    "role" TEXT,
    "email" TEXT,
    "category" TEXT,
    "content" TEXT,
    "status" TEXT,
    "approved_by" TEXT,
    "approval_status" TEXT,
    "employee" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_outstanding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "huyk_channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "channel_id" TEXT,
    "link_channel" TEXT,
    "status" TEXT,
    "team_traffic" TEXT,
    "owner" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "email" TEXT,

    CONSTRAINT "huyk_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lark_permissions" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "pin_code" TEXT,
    "employee" JSONB,
    "role" TEXT,
    "team" TEXT,
    "status" TEXT,
    "permissions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_reportsettings" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "schedule" JSONB NOT NULL,
    "one_report_per_day" BOOLEAN NOT NULL,
    "timezone" VARCHAR(50) NOT NULL,
    "is_random" BOOLEAN NOT NULL,
    "random_minutes" INTEGER NOT NULL,
    "updated_by" VARCHAR(255) NOT NULL,

    CONSTRAINT "video_management_reportsettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_facebookpagecache" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "page_name" VARCHAR(255) NOT NULL,
    "avatar_url" VARCHAR(1000) NOT NULL,
    "followers_count" BIGINT NOT NULL,
    "likes_count" BIGINT NOT NULL,
    "page_description" TEXT NOT NULL,
    "page_category" VARCHAR(255) NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "raw_data" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_fetched_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "video_management_facebookpagecache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_tiktokusercache" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "avatar_url" TEXT,
    "followers_count" BIGINT NOT NULL,
    "likes_count" BIGINT NOT NULL,
    "videos_count" INTEGER NOT NULL,
    "raw_data" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_fetched_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "video_management_tiktokusercache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_generatedcontent" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "source_video_id" BIGINT NOT NULL,
    "content_type" VARCHAR(2) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "script" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "solution" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "estimated_duration" INTEGER NOT NULL,
    "word_count" INTEGER NOT NULL,
    "ai_model" VARCHAR(50) NOT NULL,
    "prompt_used" TEXT NOT NULL,
    "is_approved" BOOLEAN NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "video_management_generatedcontent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_productlist" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "file_name" VARCHAR(500) NOT NULL,
    "file_path" VARCHAR(1000) NOT NULL,
    "total_products" INTEGER NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "video_management_productlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_product" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "product_list_id" BIGINT NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "category" VARCHAR(255) NOT NULL,
    "price" DECIMAL(15,2),
    "description" TEXT NOT NULL,
    "highlights" TEXT NOT NULL,
    "sku" VARCHAR(255) NOT NULL,
    "raw_data" JSONB NOT NULL,

    CONSTRAINT "video_management_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_localvideofile" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "file_path" VARCHAR(1000) NOT NULL,
    "folder_type" VARCHAR(50) NOT NULL,
    "folder_name" VARCHAR(50),
    "duration" DOUBLE PRECISION NOT NULL,
    "file_size" BIGINT NOT NULL,
    "has_audio" BOOLEAN NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "modified_time" TIMESTAMPTZ(6) NOT NULL,
    "last_accessed_at" TIMESTAMPTZ(6),
    "is_available" BOOLEAN NOT NULL,

    CONSTRAINT "video_management_localvideofile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_indexedvideo" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "file_path" VARCHAR(1000) NOT NULL,
    "folder_type" VARCHAR(50) NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "file_size" BIGINT NOT NULL,
    "has_audio" BOOLEAN NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "last_used_at" TIMESTAMPTZ(6),
    "use_count" INTEGER NOT NULL,
    "modified_time" TIMESTAMPTZ(6) NOT NULL,
    "is_available" BOOLEAN NOT NULL,

    CONSTRAINT "video_management_indexedvideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_videoclipcache" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "source_video_id" BIGINT NOT NULL,
    "clip_path" VARCHAR(1000) NOT NULL,
    "start_time" DOUBLE PRECISION NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "file_size" BIGINT NOT NULL,
    "last_accessed_at" TIMESTAMPTZ(6) NOT NULL,
    "access_count" INTEGER NOT NULL,
    "generated_with_gpu" BOOLEAN NOT NULL,
    "generation_time" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "video_management_videoclipcache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_searchquery" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "query" VARCHAR(500) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "search_count" INTEGER NOT NULL DEFAULT 1,
    "result_count" INTEGER DEFAULT 0,
    "last_searched" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "video_management_searchquery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_trendingkeyword" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "keyword" VARCHAR(500) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" VARCHAR(50) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "total_likes" BIGINT,
    "total_views" BIGINT,
    "trend_score" DOUBLE PRECISION,
    "video_count" INTEGER,

    CONSTRAINT "video_management_trendingkeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_appuser" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "lark_id" VARCHAR(255),
    "role" VARCHAR(50) NOT NULL,
    "team" VARCHAR(100),

    CONSTRAINT "video_management_appuser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lark_report_kpi" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT,
    "name" TEXT,
    "email" TEXT,
    "team" TEXT,
    "month" TEXT,
    "report_date" TIMESTAMP(3),
    "kpi_day" INTEGER,
    "kpi_month" INTEGER,
    "completed_day" INTEGER,
    "completed_month" INTEGER,
    "kpi_status" TEXT,
    "task_auto" INTEGER,
    "task_auto_month" INTEGER,
    "task_new" INTEGER,
    "task_new_month" INTEGER,
    "traffic_month" BIGINT,
    "revenue_month" BIGINT,
    "revenue_day" BIGINT,
    "status" TEXT,
    "image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_report_kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lark_list_tasks" (
    "id" TEXT NOT NULL,
    "caption" TEXT,
    "deadline" TEXT,
    "file_content_url" TEXT,
    "file_content_name" TEXT,
    "file_voice_token" TEXT,
    "employee_id" TEXT,
    "employee_name" TEXT,
    "employee_email" TEXT,
    "content" TEXT,
    "sku" TEXT,
    "source_huyk" TEXT,
    "source_outro" TEXT,
    "source_collection" TEXT,
    "team" TEXT,
    "tiktok_post" TEXT,
    "status" TEXT,
    "content_type" TEXT,
    "product_name" TEXT,
    "link_tiktok" TEXT,
    "date" TIMESTAMP(3),
    "created_at_lark" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_list_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_channelanalysis" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "max_posts" INTEGER NOT NULL,
    "insights" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "video_management_channelanalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approved_content" (
    "id" TEXT NOT NULL,
    "script" TEXT NOT NULL,
    "content_type" VARCHAR(20) NOT NULL,
    "content_type_display" VARCHAR(100) NOT NULL,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "source_video_id" VARCHAR(255),
    "source_video_title" TEXT NOT NULL DEFAULT '',
    "source_video_desc" TEXT NOT NULL DEFAULT '',
    "source_video_url" VARCHAR(2000) NOT NULL DEFAULT '',
    "product_id" VARCHAR(100),
    "product_name" VARCHAR(255),
    "product_category" VARCHAR(255),
    "product_sku" VARCHAR(100),
    "approved_by_id" TEXT NOT NULL,
    "approved_by_name" TEXT NOT NULL DEFAULT '',
    "approved_by_role" "UserRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approved_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_library" (
    "id" TEXT NOT NULL,
    "video_id" VARCHAR(255) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "video_url" VARCHAR(2000) NOT NULL,
    "author_username" VARCHAR(255) NOT NULL,
    "author_name" VARCHAR(255) NOT NULL,
    "thumbnail_url" VARCHAR(2000),
    "views_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "comments_count" BIGINT NOT NULL DEFAULT 0,
    "shares_count" BIGINT NOT NULL DEFAULT 0,
    "collection_type" "CollectionType" NOT NULL,
    "added_by_id" TEXT NOT NULL,
    "added_by_name" TEXT NOT NULL DEFAULT '',
    "added_by_role" "UserRole" NOT NULL,
    "notes" TEXT,
    "sourcing_url" VARCHAR(4000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "platform_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "avatar_url" TEXT,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "parent_id" TEXT,
    "extra_data" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "message" TEXT NOT NULL,
    "media_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "page_id" TEXT,
    "privacy" TEXT DEFAULT 'PUBLIC',
    "status" "SocialPostStatus" NOT NULL DEFAULT 'PENDING',
    "source" "SocialPostSource" NOT NULL DEFAULT 'IMMEDIATE',
    "scheduled_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3),
    "result" JSONB,
    "error_msg" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_media_files" (
    "id" TEXT NOT NULL,
    "post_id" TEXT,
    "filename" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL DEFAULT 'video/mp4',
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_media_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_oauth_states" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "tiktok_verifier" TEXT,
    "zalo_verifier" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT,
    "message" TEXT NOT NULL,
    "media_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "platform" "SocialPlatform",
    "account_id" TEXT,
    "page_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_uploaded_files" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalname" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "storage" TEXT NOT NULL DEFAULT 'supabase',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_uploaded_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_lark_employee_record_id_key" ON "users"("lark_employee_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_roles_idx" ON "users"("roles");

-- CreateIndex
CREATE INDEX "users_manager_id_idx" ON "users"("manager_id");

-- CreateIndex
CREATE INDEX "users_team_leader_id_idx" ON "users"("team_leader_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_key" ON "role_permissions"("role");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_channels_lark_channel_id_key" ON "tracked_channels"("lark_channel_id");

-- CreateIndex
CREATE INDEX "tracked_channels_user_id_idx" ON "tracked_channels"("user_id");

-- CreateIndex
CREATE INDEX "tracked_channels_platform_idx" ON "tracked_channels"("platform");

-- CreateIndex
CREATE INDEX "tracked_channels_is_active_idx" ON "tracked_channels"("is_active");

-- CreateIndex
CREATE INDEX "tracked_channels_added_via_idx" ON "tracked_channels"("added_via");

-- CreateIndex
CREATE INDEX "tracked_channels_user_id_is_active_idx" ON "tracked_channels"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "tracked_channels_user_id_platform_is_active_idx" ON "tracked_channels"("user_id", "platform", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_channels_user_id_platform_username_key" ON "tracked_channels"("user_id", "platform", "username");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_voice_voice_id_key" ON "video_management_voice"("voice_id");

-- CreateIndex
CREATE INDEX "video_management_voice_provider_idx" ON "video_management_voice"("provider");

-- CreateIndex
CREATE INDEX "video_management_voice_is_cloned_idx" ON "video_management_voice"("is_cloned");

-- CreateIndex
CREATE INDEX "video_management_voice_voice_id_idx" ON "video_management_voice"("voice_id");

-- CreateIndex
CREATE INDEX "video_management_voice_provider_is_system_idx" ON "video_management_voice"("provider", "is_system");

-- CreateIndex
CREATE INDEX "videos_user_id_idx" ON "videos"("user_id");

-- CreateIndex
CREATE INDEX "videos_content_hash_idx" ON "videos"("content_hash");

-- CreateIndex
CREATE INDEX "video_posts_video_id_idx" ON "video_posts"("video_id");

-- CreateIndex
CREATE INDEX "video_posts_channel_id_idx" ON "video_posts"("channel_id");

-- CreateIndex
CREATE INDEX "video_posts_platform_idx" ON "video_posts"("platform");

-- CreateIndex
CREATE INDEX "video_posts_posted_at_idx" ON "video_posts"("posted_at");

-- CreateIndex
CREATE UNIQUE INDEX "video_posts_video_id_channel_id_key" ON "video_posts"("video_id", "channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_fingerprints_video_id_key" ON "video_fingerprints"("video_id");

-- CreateIndex
CREATE INDEX "video_fingerprints_video_id_idx" ON "video_fingerprints"("video_id");

-- CreateIndex
CREATE INDEX "video_groups_master_video_id_idx" ON "video_groups"("master_video_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_duplicates_video_id_key" ON "video_duplicates"("video_id");

-- CreateIndex
CREATE INDEX "video_duplicates_group_id_idx" ON "video_duplicates"("group_id");

-- CreateIndex
CREATE INDEX "video_duplicates_video_id_idx" ON "video_duplicates"("video_id");

-- CreateIndex
CREATE INDEX "video_duplicates_status_idx" ON "video_duplicates"("status");

-- CreateIndex
CREATE INDEX "video_duplicates_reviewed_by_idx" ON "video_duplicates"("reviewed_by");

-- CreateIndex
CREATE UNIQUE INDEX "auth_group_name_key" ON "auth_group"("name");

-- CreateIndex
CREATE INDEX "auth_group_name_a6ea08ec_like" ON "auth_group"("name");

-- CreateIndex
CREATE INDEX "auth_group_permissions_group_id_b120cbf9" ON "auth_group_permissions"("group_id");

-- CreateIndex
CREATE INDEX "auth_group_permissions_permission_id_84c5c92e" ON "auth_group_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_group_permissions_group_id_permission_id_0cd325b0_uniq" ON "auth_group_permissions"("group_id", "permission_id");

-- CreateIndex
CREATE INDEX "auth_permission_content_type_id_2f476e4b" ON "auth_permission"("content_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_permission_content_type_id_codename_01ab375a_uniq" ON "auth_permission"("content_type_id", "codename");

-- CreateIndex
CREATE UNIQUE INDEX "auth_user_username_key" ON "auth_user"("username");

-- CreateIndex
CREATE INDEX "auth_user_username_6821ab7c_like" ON "auth_user"("username");

-- CreateIndex
CREATE INDEX "auth_user_groups_group_id_97559544" ON "auth_user_groups"("group_id");

-- CreateIndex
CREATE INDEX "auth_user_groups_user_id_6a12ed8b" ON "auth_user_groups"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_user_groups_user_id_group_id_94350c0c_uniq" ON "auth_user_groups"("user_id", "group_id");

-- CreateIndex
CREATE INDEX "auth_user_user_permissions_permission_id_1fbb5f2c" ON "auth_user_user_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "auth_user_user_permissions_user_id_a95ead1b" ON "auth_user_user_permissions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_user_user_permissions_user_id_permission_id_14a6b632_uniq" ON "auth_user_user_permissions"("user_id", "permission_id");

-- CreateIndex
CREATE INDEX "django_admin_log_content_type_id_c4bce8eb" ON "django_admin_log"("content_type_id");

-- CreateIndex
CREATE INDEX "django_admin_log_user_id_c564eba6" ON "django_admin_log"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "django_content_type_app_label_model_76bd3d3b_uniq" ON "django_content_type"("app_label", "model");

-- CreateIndex
CREATE INDEX "django_session_expire_date_a5c62663" ON "django_session"("expire_date");

-- CreateIndex
CREATE INDEX "django_session_session_key_c0390e0f_like" ON "django_session"("session_key");

-- CreateIndex
CREATE INDEX "video_manag_collect_c2bc46_idx" ON "video_management_collectionvideo"("collection_id", "order");

-- CreateIndex
CREATE INDEX "video_management_collectionvideo_collection_id_fc800f8b" ON "video_management_collectionvideo"("collection_id");

-- CreateIndex
CREATE INDEX "video_management_collectionvideo_created_at_e9cfa690" ON "video_management_collectionvideo"("created_at");

-- CreateIndex
CREATE INDEX "video_management_collectionvideo_video_id_38c886e2" ON "video_management_collectionvideo"("video_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_collect_collection_id_video_id_e6a6a43b_uniq" ON "video_management_collectionvideo"("collection_id", "video_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_scrapedvideo_video_id_key" ON "video_management_scrapedvideo"("video_id");

-- CreateIndex
CREATE INDEX "video_manag_author__e7db45_idx" ON "video_management_scrapedvideo"("author_username", "created_at" DESC);

-- CreateIndex
CREATE INDEX "video_manag_platfor_4f25a9_idx" ON "video_management_scrapedvideo"("platform", "likes_count" DESC);

-- CreateIndex
CREATE INDEX "video_manag_platfor_d00e35_idx" ON "video_management_scrapedvideo"("platform", "views_count" DESC);

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_author_username_0abb69cc" ON "video_management_scrapedvideo"("author_username");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_author_username_0abb69cc_like" ON "video_management_scrapedvideo"("author_username");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_created_at_ff4531cf" ON "video_management_scrapedvideo"("created_at");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_likes_count_3b349153" ON "video_management_scrapedvideo"("likes_count");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_platform_50b13b79" ON "video_management_scrapedvideo"("platform");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_platform_50b13b79_like" ON "video_management_scrapedvideo"("platform");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_published_at_085ce534" ON "video_management_scrapedvideo"("published_at");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_search_history_id_99cbd2b6" ON "video_management_scrapedvideo"("search_history_id");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_video_id_daf67164_like" ON "video_management_scrapedvideo"("video_id");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_views_count_deb87e4a" ON "video_management_scrapedvideo"("views_count");

-- CreateIndex
CREATE INDEX "video_manag_platfor_cf643f_idx" ON "video_management_searchhistory"("platform", "keyword", "created_at" DESC);

-- CreateIndex
CREATE INDEX "video_manag_status_b42a65_idx" ON "video_management_searchhistory"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "video_management_searchhistory_created_at_442e2a9a" ON "video_management_searchhistory"("created_at");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_expires_at_1e28339e" ON "video_management_searchhistory"("expires_at");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_keyword_58f4c4f0" ON "video_management_searchhistory"("keyword");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_keyword_58f4c4f0_like" ON "video_management_searchhistory"("keyword");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_platform_6a299e04" ON "video_management_searchhistory"("platform");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_platform_6a299e04_like" ON "video_management_searchhistory"("platform");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_status_2477ce49" ON "video_management_searchhistory"("status");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_status_2477ce49_like" ON "video_management_searchhistory"("status");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_task_id_00dd06c2" ON "video_management_searchhistory"("task_id");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_task_id_00dd06c2_like" ON "video_management_searchhistory"("task_id");

-- CreateIndex
CREATE INDEX "video_manag_is_acti_28ee72_idx" ON "video_management_trackedchannel"("is_active", "last_checked_at");

-- CreateIndex
CREATE INDEX "video_manag_platfor_25d894_idx" ON "video_management_trackedchannel"("platform", "is_active");

-- CreateIndex
CREATE INDEX "video_management_trackedchannel_created_at_c9729328" ON "video_management_trackedchannel"("created_at");

-- CreateIndex
CREATE INDEX "video_management_trackedchannel_is_active_f81e2fe8" ON "video_management_trackedchannel"("is_active");

-- CreateIndex
CREATE INDEX "video_management_trackedchannel_platform_4d998742" ON "video_management_trackedchannel"("platform");

-- CreateIndex
CREATE INDEX "video_management_trackedchannel_platform_4d998742_like" ON "video_management_trackedchannel"("platform");

-- CreateIndex
CREATE INDEX "video_management_trackedchannel_username_eb875a82" ON "video_management_trackedchannel"("username");

-- CreateIndex
CREATE INDEX "video_management_trackedchannel_username_eb875a82_like" ON "video_management_trackedchannel"("username");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_tracked_platform_channel_id_7adddef1_uniq" ON "video_management_trackedchannel"("platform", "channel_id");

-- CreateIndex
CREATE INDEX "video_manag_name_1e4f76_idx" ON "video_management_videocollection"("name", "created_at" DESC);

-- CreateIndex
CREATE INDEX "video_management_videocollection_created_at_6dd29d12" ON "video_management_videocollection"("created_at");

-- CreateIndex
CREATE INDEX "video_management_videocollection_name_fff3286f" ON "video_management_videocollection"("name");

-- CreateIndex
CREATE INDEX "video_management_videocollection_name_fff3286f_like" ON "video_management_videocollection"("name");

-- CreateIndex
CREATE INDEX "search_histories_user_id_idx" ON "search_histories"("user_id");

-- CreateIndex
CREATE INDEX "search_histories_timestamp_idx" ON "search_histories"("timestamp");

-- CreateIndex
CREATE INDEX "lark_reports_date_idx" ON "lark_reports"("date");

-- CreateIndex
CREATE INDEX "lark_reports_date_team_idx" ON "lark_reports"("date", "team");

-- CreateIndex
CREATE INDEX "lark_reports_email_idx" ON "lark_reports"("email");

-- CreateIndex
CREATE INDEX "lark_reports_name_idx" ON "lark_reports"("name");

-- CreateIndex
CREATE INDEX "lark_kpi_month_idx" ON "lark_kpi"("month");

-- CreateIndex
CREATE INDEX "lark_kpi_report_date_team_idx" ON "lark_kpi"("report_date", "team");

-- CreateIndex
CREATE INDEX "lark_kpi_state_month_team_idx" ON "lark_kpi"("state", "month", "team");

-- CreateIndex
CREATE INDEX "lark_kpi_team_idx" ON "lark_kpi"("team");

-- CreateIndex
CREATE INDEX "lark_kpi_name_idx" ON "lark_kpi"("name");

-- CreateIndex
CREATE INDEX "lark_kpi_employee_id_idx" ON "lark_kpi"("employee_id");

-- CreateIndex
CREATE INDEX "lark_kpi_do_da_month_idx" ON "lark_kpi_do_da"("month");

-- CreateIndex
CREATE INDEX "lark_kpi_do_da_report_date_team_idx" ON "lark_kpi_do_da"("report_date", "team");

-- CreateIndex
CREATE INDEX "lark_kpi_do_da_team_idx" ON "lark_kpi_do_da"("team");

-- CreateIndex
CREATE INDEX "lark_kpi_do_da_name_idx" ON "lark_kpi_do_da"("name");

-- CreateIndex
CREATE INDEX "lark_kpi_do_da_employee_id_idx" ON "lark_kpi_do_da"("employee_id");

-- CreateIndex
CREATE INDEX "lark_kpi_do_da_editor_report_date_idx" ON "lark_kpi_do_da_editor"("report_date");

-- CreateIndex
CREATE INDEX "lark_kpi_do_da_editor_report_date_key_team_idx" ON "lark_kpi_do_da_editor"("report_date_key", "team");

-- CreateIndex
CREATE INDEX "lark_kpi_do_da_editor_editor_name_idx" ON "lark_kpi_do_da_editor"("editor_name");

-- CreateIndex
CREATE INDEX "lark_kpi_do_da_editor_editor_name_key_month_idx" ON "lark_kpi_do_da_editor"("editor_name_key", "month");

-- CreateIndex
CREATE INDEX "lark_traffic_date_idx" ON "lark_traffic"("date");

-- CreateIndex
CREATE INDEX "lark_traffic_date_team_idx" ON "lark_traffic"("date", "team");

-- CreateIndex
CREATE INDEX "lark_traffic_month_idx" ON "lark_traffic"("month");

-- CreateIndex
CREATE INDEX "lark_traffic_team_idx" ON "lark_traffic"("team");

-- CreateIndex
CREATE INDEX "lark_traffic_email_idx" ON "lark_traffic"("email");

-- CreateIndex
CREATE INDEX "report_outstanding_date_created_at_idx" ON "report_outstanding"("date", "created_at");

-- CreateIndex
CREATE INDEX "huyk_channels_owner_idx" ON "huyk_channels"("owner");

-- CreateIndex
CREATE INDEX "huyk_channels_email_idx" ON "huyk_channels"("email");

-- CreateIndex
CREATE INDEX "huyk_channels_team_traffic_idx" ON "huyk_channels"("team_traffic");

-- CreateIndex
CREATE INDEX "huyk_channels_email_status_idx" ON "huyk_channels"("email", "status");

-- CreateIndex
CREATE INDEX "huyk_channels_platform_status_idx" ON "huyk_channels"("platform", "status");

-- CreateIndex
CREATE INDEX "lark_permissions_email_idx" ON "lark_permissions"("email");

-- CreateIndex
CREATE INDEX "lark_permissions_name_idx" ON "lark_permissions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_facebookpagecache_username_key" ON "video_management_facebookpagecache"("username");

-- CreateIndex
CREATE INDEX "video_management_facebookpagecache_username_idx" ON "video_management_facebookpagecache"("username");

-- CreateIndex
CREATE INDEX "video_management_facebookpagecache_expires_at_idx" ON "video_management_facebookpagecache"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_tiktokusercache_username_key" ON "video_management_tiktokusercache"("username");

-- CreateIndex
CREATE INDEX "video_management_tiktokusercache_username_idx" ON "video_management_tiktokusercache"("username");

-- CreateIndex
CREATE INDEX "video_management_tiktokusercache_expires_at_idx" ON "video_management_tiktokusercache"("expires_at");

-- CreateIndex
CREATE INDEX "video_management_product_product_list_id_idx" ON "video_management_product"("product_list_id");

-- CreateIndex
CREATE INDEX "video_management_product_name_idx" ON "video_management_product"("name");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_localvideofile_file_path_key" ON "video_management_localvideofile"("file_path");

-- CreateIndex
CREATE INDEX "video_management_localvideofile_folder_type_idx" ON "video_management_localvideofile"("folder_type");

-- CreateIndex
CREATE INDEX "video_management_indexedvideo_file_path_idx" ON "video_management_indexedvideo"("file_path");

-- CreateIndex
CREATE INDEX "video_management_indexedvideo_folder_type_idx" ON "video_management_indexedvideo"("folder_type");

-- CreateIndex
CREATE INDEX "video_management_indexedvideo_is_available_idx" ON "video_management_indexedvideo"("is_available");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_indexedvideo_file_path_folder_type_key" ON "video_management_indexedvideo"("file_path", "folder_type");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_videoclipcache_clip_path_key" ON "video_management_videoclipcache"("clip_path");

-- CreateIndex
CREATE INDEX "video_management_videoclipcache_source_video_id_idx" ON "video_management_videoclipcache"("source_video_id");

-- CreateIndex
CREATE INDEX "video_management_videoclipcache_clip_path_idx" ON "video_management_videoclipcache"("clip_path");

-- CreateIndex
CREATE INDEX "video_management_searchquery_query_idx" ON "video_management_searchquery"("query");

-- CreateIndex
CREATE INDEX "video_management_searchquery_platform_idx" ON "video_management_searchquery"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_searchquery_query_platform_49712969_uniq" ON "video_management_searchquery"("query", "platform");

-- CreateIndex
CREATE INDEX "video_management_trendingkeyword_keyword_idx" ON "video_management_trendingkeyword"("keyword");

-- CreateIndex
CREATE INDEX "video_management_trendingkeyword_platform_idx" ON "video_management_trendingkeyword"("platform");

-- CreateIndex
CREATE INDEX "video_management_trendingkeyword_expires_at_idx" ON "video_management_trendingkeyword"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_trendingkeyword_keyword_platform_c976f167_uniq" ON "video_management_trendingkeyword"("keyword", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_appuser_email_key" ON "video_management_appuser"("email");

-- CreateIndex
CREATE INDEX "video_management_appuser_email_idx" ON "video_management_appuser"("email");

-- CreateIndex
CREATE INDEX "lark_report_kpi_report_date_idx" ON "lark_report_kpi"("report_date");

-- CreateIndex
CREATE INDEX "lark_report_kpi_report_date_team_idx" ON "lark_report_kpi"("report_date", "team");

-- CreateIndex
CREATE INDEX "lark_report_kpi_email_idx" ON "lark_report_kpi"("email");

-- CreateIndex
CREATE INDEX "lark_report_kpi_name_idx" ON "lark_report_kpi"("name");

-- CreateIndex
CREATE INDEX "lark_list_tasks_employee_id_idx" ON "lark_list_tasks"("employee_id");

-- CreateIndex
CREATE INDEX "lark_list_tasks_employee_email_idx" ON "lark_list_tasks"("employee_email");

-- CreateIndex
CREATE INDEX "lark_list_tasks_team_idx" ON "lark_list_tasks"("team");

-- CreateIndex
CREATE INDEX "video_manag_platfor_426825_idx" ON "video_management_channelanalysis"("platform", "username");

-- CreateIndex
CREATE INDEX "video_management_channelanalysis_created_at_70c78ae7" ON "video_management_channelanalysis"("created_at");

-- CreateIndex
CREATE INDEX "video_management_channelanalysis_platform_e38a218a" ON "video_management_channelanalysis"("platform");

-- CreateIndex
CREATE INDEX "video_management_channelanalysis_platform_e38a218a_like" ON "video_management_channelanalysis"("platform");

-- CreateIndex
CREATE INDEX "video_management_channelanalysis_username_22fc03be" ON "video_management_channelanalysis"("username");

-- CreateIndex
CREATE INDEX "video_management_channelanalysis_username_22fc03be_like" ON "video_management_channelanalysis"("username");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_channel_platform_username_bb55e90a_uniq" ON "video_management_channelanalysis"("platform", "username");

-- CreateIndex
CREATE INDEX "approved_content_approved_by_id_idx" ON "approved_content"("approved_by_id");

-- CreateIndex
CREATE INDEX "approved_content_created_at_idx" ON "approved_content"("created_at" DESC);

-- CreateIndex
CREATE INDEX "video_library_collection_type_created_at_idx" ON "video_library"("collection_type", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "video_library_video_id_collection_type_key" ON "video_library"("video_id", "collection_type");

-- CreateIndex
CREATE INDEX "social_accounts_user_id_idx" ON "social_accounts"("user_id");

-- CreateIndex
CREATE INDEX "social_accounts_platform_idx" ON "social_accounts"("platform");

-- CreateIndex
CREATE INDEX "social_accounts_parent_id_idx" ON "social_accounts"("parent_id");

-- CreateIndex
CREATE INDEX "social_accounts_is_active_idx" ON "social_accounts"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_user_id_platform_platform_id_key" ON "social_accounts"("user_id", "platform", "platform_id");

-- CreateIndex
CREATE INDEX "social_posts_user_id_idx" ON "social_posts"("user_id");

-- CreateIndex
CREATE INDEX "social_posts_account_id_idx" ON "social_posts"("account_id");

-- CreateIndex
CREATE INDEX "social_posts_status_idx" ON "social_posts"("status");

-- CreateIndex
CREATE INDEX "social_posts_source_idx" ON "social_posts"("source");

-- CreateIndex
CREATE INDEX "social_posts_scheduled_at_idx" ON "social_posts"("scheduled_at");

-- CreateIndex
CREATE INDEX "social_posts_next_retry_at_idx" ON "social_posts"("next_retry_at");

-- CreateIndex
CREATE INDEX "social_posts_status_scheduled_at_idx" ON "social_posts"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "social_media_files_filename_key" ON "social_media_files"("filename");

-- CreateIndex
CREATE INDEX "social_media_files_post_id_idx" ON "social_media_files"("post_id");

-- CreateIndex
CREATE INDEX "social_media_files_filename_idx" ON "social_media_files"("filename");

-- CreateIndex
CREATE INDEX "social_oauth_states_expires_at_idx" ON "social_oauth_states"("expires_at");

-- CreateIndex
CREATE INDEX "social_drafts_user_id_idx" ON "social_drafts"("user_id");

-- CreateIndex
CREATE INDEX "social_uploaded_files_user_id_idx" ON "social_uploaded_files"("user_id");

-- CreateIndex
CREATE INDEX "social_uploaded_files_created_at_idx" ON "social_uploaded_files"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_team_leader_id_fkey" FOREIGN KEY ("team_leader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_channels" ADD CONSTRAINT "tracked_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_posts" ADD CONSTRAINT "video_posts_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "tracked_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_posts" ADD CONSTRAINT "video_posts_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_fingerprints" ADD CONSTRAINT "video_fingerprints_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_duplicates" ADD CONSTRAINT "video_duplicates_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "video_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_duplicates" ADD CONSTRAINT "video_duplicates_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_duplicates" ADD CONSTRAINT "video_duplicates_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_group_permissions" ADD CONSTRAINT "auth_group_permissio_permission_id_84c5c92e_fk_auth_perm" FOREIGN KEY ("permission_id") REFERENCES "auth_permission"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_group_permissions" ADD CONSTRAINT "auth_group_permissions_group_id_b120cbf9_fk_auth_group_id" FOREIGN KEY ("group_id") REFERENCES "auth_group"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_permission" ADD CONSTRAINT "auth_permission_content_type_id_2f476e4b_fk_django_co" FOREIGN KEY ("content_type_id") REFERENCES "django_content_type"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_user_groups" ADD CONSTRAINT "auth_user_groups_group_id_97559544_fk_auth_group_id" FOREIGN KEY ("group_id") REFERENCES "auth_group"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_user_groups" ADD CONSTRAINT "auth_user_groups_user_id_6a12ed8b_fk_auth_user_id" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_user_user_permissions" ADD CONSTRAINT "auth_user_user_permi_permission_id_1fbb5f2c_fk_auth_perm" FOREIGN KEY ("permission_id") REFERENCES "auth_permission"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_user_user_permissions" ADD CONSTRAINT "auth_user_user_permissions_user_id_a95ead1b_fk_auth_user_id" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "django_admin_log" ADD CONSTRAINT "django_admin_log_content_type_id_c4bce8eb_fk_django_co" FOREIGN KEY ("content_type_id") REFERENCES "django_content_type"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "django_admin_log" ADD CONSTRAINT "django_admin_log_user_id_c564eba6_fk_auth_user_id" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "video_management_collectionvideo" ADD CONSTRAINT "video_management_col_collection_id_fc800f8b_fk_video_man" FOREIGN KEY ("collection_id") REFERENCES "video_management_videocollection"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "video_management_collectionvideo" ADD CONSTRAINT "video_management_col_video_id_38c886e2_fk_video_man" FOREIGN KEY ("video_id") REFERENCES "video_management_scrapedvideo"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "video_management_scrapedvideo" ADD CONSTRAINT "video_management_scr_search_history_id_99cbd2b6_fk_video_man" FOREIGN KEY ("search_history_id") REFERENCES "video_management_searchhistory"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "search_histories" ADD CONSTRAINT "search_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_management_product" ADD CONSTRAINT "video_management_product_product_list_id_fkey" FOREIGN KEY ("product_list_id") REFERENCES "video_management_productlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_management_videoclipcache" ADD CONSTRAINT "video_management_videoclipcache_source_video_id_fkey" FOREIGN KEY ("source_video_id") REFERENCES "video_management_indexedvideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_media_files" ADD CONSTRAINT "social_media_files_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
