-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'EDITOR', 'CONTENT');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('TIKTOK', 'INSTAGRAM', 'FACEBOOK', 'DOUYIN', 'XIAOHONGSHU');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "full_name" TEXT NOT NULL,
    "avatar" TEXT,
    "google_id" TEXT,
    "role" "UserRole" NOT NULL,
    "manager_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3),
    "total_login_count" INTEGER NOT NULL DEFAULT 0,
    "total_action_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_activity_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "description" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_usage_stats" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "login_count" INTEGER NOT NULL DEFAULT 0,
    "action_count" INTEGER NOT NULL DEFAULT 0,
    "video_generated" INTEGER NOT NULL DEFAULT 0,
    "api_request_count" INTEGER NOT NULL DEFAULT 0,
    "last_action_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_usage_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_rate_limits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "max_per_minute" INTEGER NOT NULL DEFAULT 60,
    "max_per_day" INTEGER NOT NULL DEFAULT 1000,
    "current_count" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_rate_limits_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "tracked_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_manager_id_idx" ON "users"("manager_id");

-- CreateIndex
CREATE INDEX "users_last_login_at_idx" ON "users"("last_login_at");

-- CreateIndex
CREATE INDEX "user_activity_logs_user_id_idx" ON "user_activity_logs"("user_id");

-- CreateIndex
CREATE INDEX "user_activity_logs_action_idx" ON "user_activity_logs"("action");

-- CreateIndex
CREATE INDEX "user_activity_logs_created_at_idx" ON "user_activity_logs"("created_at");

-- CreateIndex
CREATE INDEX "user_activity_logs_target_type_target_id_idx" ON "user_activity_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "user_usage_stats_user_id_idx" ON "user_usage_stats"("user_id");

-- CreateIndex
CREATE INDEX "user_usage_stats_date_idx" ON "user_usage_stats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "user_usage_stats_user_id_date_key" ON "user_usage_stats"("user_id", "date");

-- CreateIndex
CREATE INDEX "user_rate_limits_user_id_idx" ON "user_rate_limits"("user_id");

-- CreateIndex
CREATE INDEX "user_rate_limits_action_type_idx" ON "user_rate_limits"("action_type");

-- CreateIndex
CREATE INDEX "user_rate_limits_blocked_until_idx" ON "user_rate_limits"("blocked_until");

-- CreateIndex
CREATE UNIQUE INDEX "user_rate_limits_user_id_action_type_key" ON "user_rate_limits"("user_id", "action_type");

-- CreateIndex
CREATE INDEX "tracked_channels_user_id_idx" ON "tracked_channels"("user_id");

-- CreateIndex
CREATE INDEX "tracked_channels_platform_idx" ON "tracked_channels"("platform");

-- CreateIndex
CREATE INDEX "tracked_channels_is_active_idx" ON "tracked_channels"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_channels_user_id_platform_username_key" ON "tracked_channels"("user_id", "platform", "username");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_activity_logs" ADD CONSTRAINT "user_activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_usage_stats" ADD CONSTRAINT "user_usage_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_rate_limits" ADD CONSTRAINT "user_rate_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_channels" ADD CONSTRAINT "tracked_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
