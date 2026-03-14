/*
  Warnings:

  - The values [EDITOR,CONTENT] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `last_activity_at` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `last_login_at` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `total_action_count` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `total_login_count` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `duplicate_reviews` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `user_activity_logs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `user_rate_limits` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `user_usage_stats` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum (safe version: handles both fresh install and existing DB with manual migrations)
DO $$
BEGIN
  CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'MANAGER', 'MEMBER');

  -- Only alter roles column if it already exists (was added via manual migration)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'roles'
  ) THEN
    -- Drop DEFAULT first (PostgreSQL cannot auto-cast default value to new enum type)
    ALTER TABLE "users" ALTER COLUMN "roles" DROP DEFAULT;
    -- Alter type (pre-migrate scripts have already mapped old values to ADMIN/MANAGER/MEMBER)
    ALTER TABLE "users" ALTER COLUMN "roles" TYPE "UserRole_new"[] USING ("roles"::text::"UserRole_new"[]);
    -- Restore DEFAULT with new enum type
    ALTER TABLE "users" ALTER COLUMN "roles" SET DEFAULT ARRAY[]::"UserRole_new"[];
  END IF;

  -- Only alter role_permissions if table already exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'role_permissions'
  ) THEN
    ALTER TABLE "role_permissions" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
  END IF;

  ALTER TYPE "UserRole" RENAME TO "UserRole_old";
  ALTER TYPE "UserRole_new" RENAME TO "UserRole";
  DROP TYPE "UserRole_old" CASCADE;
END $$;

-- DropForeignKey
ALTER TABLE "duplicate_reviews" DROP CONSTRAINT IF EXISTS "duplicate_reviews_new_video_id_fkey";

-- DropForeignKey
ALTER TABLE "duplicate_reviews" DROP CONSTRAINT IF EXISTS "duplicate_reviews_reviewed_by_fkey";

-- DropForeignKey
ALTER TABLE "duplicate_reviews" DROP CONSTRAINT IF EXISTS "duplicate_reviews_suspected_duplicate_of_fkey";

-- DropForeignKey
ALTER TABLE "user_activity_logs" DROP CONSTRAINT IF EXISTS "user_activity_logs_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_rate_limits" DROP CONSTRAINT IF EXISTS "user_rate_limits_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_usage_stats" DROP CONSTRAINT IF EXISTS "user_usage_stats_user_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "users_last_login_at_idx";

-- DropIndex
DROP INDEX IF EXISTS "users_role_idx";

-- AlterTable
ALTER TABLE "tracked_channels" ADD COLUMN     "posts_count" INTEGER;

-- AlterTable (safe: IF EXISTS for columns that may have been dropped by CASCADE)
ALTER TABLE "users"
  DROP COLUMN IF EXISTS "last_activity_at",
  DROP COLUMN IF EXISTS "last_login_at",
  DROP COLUMN IF EXISTS "role",
  DROP COLUMN IF EXISTS "total_action_count",
  DROP COLUMN IF EXISTS "total_login_count",
  ADD COLUMN IF NOT EXISTS "custom_permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "lark_permissions" JSONB,
  ADD COLUMN IF NOT EXISTS "last_app_update_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "ma_pin" TEXT,
  ADD COLUMN IF NOT EXISTS "roles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[],
  ADD COLUMN IF NOT EXISTS "team" TEXT,
  ADD COLUMN IF NOT EXISTS "team_leader_id" TEXT;

-- AlterTable
ALTER TABLE "video_management_searchhistory" ADD COLUMN     "search_mode" VARCHAR(20) NOT NULL DEFAULT 'hashtag';

-- DropTable
DROP TABLE IF EXISTS "duplicate_reviews";

-- DropTable
DROP TABLE IF EXISTS "user_activity_logs";

-- DropTable
DROP TABLE IF EXISTS "user_rate_limits";

-- DropTable
DROP TABLE IF EXISTS "user_usage_stats";

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

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_key" ON "role_permissions"("role");

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
CREATE INDEX "huyk_channels_owner_idx" ON "huyk_channels"("owner");

-- CreateIndex
CREATE INDEX "huyk_channels_team_traffic_idx" ON "huyk_channels"("team_traffic");

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
CREATE INDEX "lark_employees_name_idx" ON "lark_employees"("name");

-- CreateIndex
CREATE INDEX "lark_kpi_month_idx" ON "lark_kpi"("month");

-- CreateIndex
CREATE INDEX "lark_kpi_team_idx" ON "lark_kpi"("team");

-- CreateIndex
CREATE INDEX "lark_kpi_name_idx" ON "lark_kpi"("name");

-- CreateIndex
CREATE INDEX "lark_kpi_employee_id_idx" ON "lark_kpi"("employee_id");

-- CreateIndex
CREATE INDEX "lark_reports_date_idx" ON "lark_reports"("date");

-- CreateIndex
CREATE INDEX "lark_reports_email_idx" ON "lark_reports"("email");

-- CreateIndex
CREATE INDEX "lark_reports_name_idx" ON "lark_reports"("name");

-- CreateIndex
CREATE INDEX "users_roles_idx" ON "users"("roles");

-- CreateIndex
CREATE INDEX "users_team_leader_id_idx" ON "users"("team_leader_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_team_leader_id_fkey" FOREIGN KEY ("team_leader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_management_product" ADD CONSTRAINT "video_management_product_product_list_id_fkey" FOREIGN KEY ("product_list_id") REFERENCES "video_management_productlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_management_videoclipcache" ADD CONSTRAINT "video_management_videoclipcache_source_video_id_fkey" FOREIGN KEY ("source_video_id") REFERENCES "video_management_indexedvideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
