/*
  Warnings:

  - The values [MARKETING] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'MANAGER', 'EDITOR', 'CONTENT');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TABLE "user_activity_logs" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
COMMIT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_activity_at" TIMESTAMP(3),
ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "total_action_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_login_count" INTEGER NOT NULL DEFAULT 0;

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
CREATE INDEX "users_last_login_at_idx" ON "users"("last_login_at");

-- AddForeignKey
ALTER TABLE "user_activity_logs" ADD CONSTRAINT "user_activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_usage_stats" ADD CONSTRAINT "user_usage_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_rate_limits" ADD CONSTRAINT "user_rate_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
