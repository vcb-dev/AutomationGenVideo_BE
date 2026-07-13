-- 17 bảng đã có trong schema.prisma (feature "báo cáo content/hiệu suất editor/họp/điểm danh/chat
-- VCB Assistant/ads/social report/business channel/telegram config", code BE đã dùng) nhưng CHƯA
-- từng được migrate lên DB thật — không có migration nào tạo chúng trong lịch sử commit, khả năng
-- do được thêm bằng `prisma db push` cục bộ rồi không generate migration. Nếu deploy code hiện tại
-- lên server mà không chạy file này trước, mọi API đụng các bảng này sẽ lỗi
-- "relation ... does not exist".
--
-- Đã dry-run (chạy trong transaction rồi ROLLBACK) thành công trên chính DB thật (wbium,
-- ap-southeast-1) ngày 2026-07-10 — an toàn để chạy `npx prisma migrate deploy`.
--
-- team_id/editor_id/created_by/assignee_id/user_id/scored_by_id/marked_by_id/actor_id/
-- finalized_by_id dùng kiểu UUID (không phải TEXT mặc định của Prisma) vì FK trỏ tới
-- users.id/teams.id — cả 2 cột đó là uuid native trong DB thật, khác TEXT sẽ lỗi
-- "foreign key constraint ... incompatible types: text and uuid" khi tạo constraint.

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('WIN', 'FAIL');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'ON_LEAVE', 'LATE');

-- CreateTable
CREATE TABLE "report_periods" (
    "id" TEXT NOT NULL,
    "type" "PeriodType" NOT NULL,
    "label" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_videos" (
    "id" TEXT NOT NULL,
    "team_id" UUID NOT NULL,
    "period_id" TEXT NOT NULL,
    "editor_id" UUID NOT NULL,
    "status" "VideoStatus" NOT NULL,
    "content" TEXT NOT NULL,
    "analysis" TEXT,
    "link" TEXT,
    "platform" TEXT,
    "post_date" TIMESTAMP(3),
    "views" BIGINT NOT NULL DEFAULT 0,
    "likes" BIGINT NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "thumbnail_url" TEXT,
    "video_url" TEXT,
    "highlights" TEXT,
    "improvements" TEXT,
    "leader_comment" TEXT,
    "notes" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_studies" (
    "id" TEXT NOT NULL,
    "team_id" UUID NOT NULL,
    "period_id" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT,
    "content" TEXT,
    "takeaway" TEXT,
    "link" TEXT,
    "platform" TEXT,
    "post_date" TIMESTAMP(3),
    "views" BIGINT NOT NULL DEFAULT 0,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editor_performance" (
    "id" TEXT NOT NULL,
    "team_id" UUID NOT NULL,
    "period_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "total_videos" INTEGER NOT NULL DEFAULT 0,
    "win_videos" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "analysis" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editor_performance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clone_videos" (
    "id" TEXT NOT NULL,
    "team_id" UUID NOT NULL,
    "period_id" TEXT NOT NULL,
    "editor_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "target_channel" TEXT,
    "link" TEXT,
    "platform" TEXT,
    "post_date" TIMESTAMP(3),
    "views" BIGINT NOT NULL DEFAULT 0,
    "likes" BIGINT NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "analysis" TEXT,
    "highlights" TEXT,
    "improvements" TEXT,
    "leader_comment" TEXT,
    "notes" TEXT,
    "video_url" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clone_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_items" (
    "id" TEXT NOT NULL,
    "team_id" UUID NOT NULL,
    "period_id" TEXT NOT NULL,
    "assignee_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "deadline" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "leader_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_kpi_snapshots" (
    "id" TEXT NOT NULL,
    "team_id" UUID NOT NULL,
    "period_id" TEXT NOT NULL,
    "total_videos" INTEGER NOT NULL DEFAULT 0,
    "win_videos" INTEGER NOT NULL DEFAULT 0,
    "fail_videos" INTEGER NOT NULL DEFAULT 0,
    "win_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_new_videos" INTEGER NOT NULL DEFAULT 0,
    "new_win_videos" INTEGER NOT NULL DEFAULT 0,
    "new_win_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_kpi_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_scores" (
    "id" TEXT NOT NULL,
    "content_video_id" TEXT NOT NULL,
    "scored_by_id" UUID NOT NULL,
    "score_hook" DOUBLE PRECISION NOT NULL,
    "score_content" DOUBLE PRECISION NOT NULL,
    "score_editing" DOUBLE PRECISION NOT NULL,
    "score_cta" DOUBLE PRECISION NOT NULL,
    "score_thumbnail" DOUBLE PRECISION NOT NULL,
    "score_total" DOUBLE PRECISION NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_sessions" (
    "id" TEXT NOT NULL,
    "team_id" UUID NOT NULL,
    "period_id" TEXT NOT NULL,
    "title" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "is_finalized" BOOLEAN NOT NULL DEFAULT false,
    "finalized_at" TIMESTAMP(3),
    "finalized_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "note" TEXT,
    "marked_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_session_logs" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_session_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "telegram_chat_id" TEXT,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "dashboard" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads_campaign_stats" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'meta',
    "account_id" TEXT NOT NULL,
    "account_name" TEXT,
    "campaign_id" TEXT NOT NULL,
    "campaign_name" TEXT NOT NULL,
    "team" TEXT,
    "owner" TEXT,
    "camp_type" TEXT,
    "content_type" TEXT,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "reach" BIGINT NOT NULL DEFAULT 0,
    "mess_count" INTEGER NOT NULL DEFAULT 0,
    "cost_per_mess" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "cost_per_like" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "share_count" INTEGER NOT NULL DEFAULT 0,
    "engagement_count" INTEGER NOT NULL DEFAULT 0,
    "cost_per_engagement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "date_start" TEXT NOT NULL,
    "date_stop" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_campaign_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_video_report" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "channel_name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "owner" TEXT,
    "team" TEXT,
    "title" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "views" BIGINT NOT NULL DEFAULT 0,
    "likes" BIGINT NOT NULL DEFAULT 0,
    "comments" BIGINT NOT NULL DEFAULT 0,
    "shares" BIGINT NOT NULL DEFAULT 0,
    "followers" BIGINT NOT NULL DEFAULT 0,
    "video_url" TEXT,
    "published_at" TIMESTAMP(3),
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'api',
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "social_video_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_channel_connections" (
    "id" TEXT NOT NULL,
    "channel_name" TEXT NOT NULL,
    "platform_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "connection_type" TEXT NOT NULL DEFAULT 'Kênh nội dung',
    "sync_status" TEXT NOT NULL DEFAULT 'Chưa đồng bộ',
    "last_sync_at" TIMESTAMP(3),
    "creator_email" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_channel_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_report_config" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_email" TEXT,
    "bot_token" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "schedule" TEXT NOT NULL DEFAULT '0 8 * * *',
    "formats" TEXT[] DEFAULT ARRAY['text']::TEXT[],
    "report_types" TEXT[] DEFAULT ARRAY['ads', 'traffic']::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_report_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_periods_type_idx" ON "report_periods"("type");

-- CreateIndex
CREATE INDEX "report_periods_start_date_idx" ON "report_periods"("start_date");

-- CreateIndex
CREATE UNIQUE INDEX "report_periods_type_start_date_key" ON "report_periods"("type", "start_date");

-- CreateIndex
CREATE INDEX "content_videos_team_id_period_id_status_idx" ON "content_videos"("team_id", "period_id", "status");

-- CreateIndex
CREATE INDEX "content_videos_editor_id_idx" ON "content_videos"("editor_id");

-- CreateIndex
CREATE INDEX "content_videos_period_id_idx" ON "content_videos"("period_id");

-- CreateIndex
CREATE INDEX "case_studies_team_id_period_id_idx" ON "case_studies"("team_id", "period_id");

-- CreateIndex
CREATE INDEX "case_studies_created_by_idx" ON "case_studies"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "editor_performance_team_id_period_id_user_id_key" ON "editor_performance"("team_id", "period_id", "user_id");

-- CreateIndex
CREATE INDEX "clone_videos_team_id_period_id_idx" ON "clone_videos"("team_id", "period_id");

-- CreateIndex
CREATE INDEX "clone_videos_editor_id_idx" ON "clone_videos"("editor_id");

-- CreateIndex
CREATE INDEX "action_items_team_id_period_id_idx" ON "action_items"("team_id", "period_id");

-- CreateIndex
CREATE INDEX "action_items_assignee_id_idx" ON "action_items"("assignee_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_kpi_snapshots_team_id_period_id_key" ON "team_kpi_snapshots"("team_id", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_scores_content_video_id_scored_by_id_key" ON "video_scores"("content_video_id", "scored_by_id");

-- CreateIndex
CREATE INDEX "meeting_sessions_team_id_idx" ON "meeting_sessions"("team_id");

-- CreateIndex
CREATE INDEX "meeting_sessions_period_id_idx" ON "meeting_sessions"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_sessions_team_id_period_id_key" ON "meeting_sessions"("team_id", "period_id");

-- CreateIndex
CREATE INDEX "attendance_records_user_id_idx" ON "attendance_records"("user_id");

-- CreateIndex
CREATE INDEX "attendance_records_session_id_idx" ON "attendance_records"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_session_id_user_id_key" ON "attendance_records"("session_id", "user_id");

-- CreateIndex
CREATE INDEX "meeting_session_logs_session_id_idx" ON "meeting_session_logs"("session_id");

-- CreateIndex
CREATE INDEX "chat_conversations_user_id_idx" ON "chat_conversations"("user_id");

-- CreateIndex
CREATE INDEX "chat_conversations_user_id_updated_at_idx" ON "chat_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "chat_conversations_telegram_chat_id_idx" ON "chat_conversations"("telegram_chat_id");

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_idx" ON "chat_messages"("conversation_id");

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ads_campaign_stats_year_month_idx" ON "ads_campaign_stats"("year", "month");

-- CreateIndex
CREATE INDEX "ads_campaign_stats_camp_type_year_month_idx" ON "ads_campaign_stats"("camp_type", "year", "month");

-- CreateIndex
CREATE INDEX "ads_campaign_stats_content_type_year_month_idx" ON "ads_campaign_stats"("content_type", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ads_campaign_stats_campaign_id_date_start_date_stop_key" ON "ads_campaign_stats"("campaign_id", "date_start", "date_stop");

-- CreateIndex
CREATE INDEX "social_video_report_platform_year_month_idx" ON "social_video_report"("platform", "year", "month");

-- CreateIndex
CREATE INDEX "social_video_report_username_year_month_idx" ON "social_video_report"("username", "year", "month");

-- CreateIndex
CREATE INDEX "social_video_report_team_year_month_idx" ON "social_video_report"("team", "year", "month");

-- CreateIndex
CREATE INDEX "social_video_report_year_month_idx" ON "social_video_report"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "social_video_report_platform_post_id_key" ON "social_video_report"("platform", "post_id");

-- CreateIndex
CREATE INDEX "business_channel_connections_platform_idx" ON "business_channel_connections"("platform");

-- CreateIndex
CREATE INDEX "business_channel_connections_sync_status_idx" ON "business_channel_connections"("sync_status");

-- CreateIndex
CREATE UNIQUE INDEX "business_channel_connections_platform_id_platform_key" ON "business_channel_connections"("platform_id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_report_config_user_id_key" ON "telegram_report_config"("user_id");

-- CreateIndex
CREATE INDEX "telegram_report_config_user_email_idx" ON "telegram_report_config"("user_email");

-- AddForeignKey
ALTER TABLE "content_videos" ADD CONSTRAINT "content_videos_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_videos" ADD CONSTRAINT "content_videos_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "report_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_videos" ADD CONSTRAINT "content_videos_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "report_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_performance" ADD CONSTRAINT "editor_performance_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_performance" ADD CONSTRAINT "editor_performance_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "report_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_performance" ADD CONSTRAINT "editor_performance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clone_videos" ADD CONSTRAINT "clone_videos_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clone_videos" ADD CONSTRAINT "clone_videos_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "report_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clone_videos" ADD CONSTRAINT "clone_videos_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "report_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_kpi_snapshots" ADD CONSTRAINT "team_kpi_snapshots_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_kpi_snapshots" ADD CONSTRAINT "team_kpi_snapshots_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "report_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_scores" ADD CONSTRAINT "video_scores_content_video_id_fkey" FOREIGN KEY ("content_video_id") REFERENCES "content_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_scores" ADD CONSTRAINT "video_scores_scored_by_id_fkey" FOREIGN KEY ("scored_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "report_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_marked_by_id_fkey" FOREIGN KEY ("marked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_session_logs" ADD CONSTRAINT "meeting_session_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_session_logs" ADD CONSTRAINT "meeting_session_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

