-- Chốt kết quả thực hiện task theo ngày cho cả task A4 tự động và Kế hoạch ngày các tuyến khác.
-- Mỗi dòng là một bản chụp sau hạn chót, dùng để cảnh báo và tra cứu lịch sử thiếu task.

DO $$ BEGIN
    CREATE TYPE "DailyTaskComplianceSource" AS ENUM ('AUTO_A4', 'DAILY_PLAN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "daily_task_compliance" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "content_line_id" TEXT NOT NULL,
    "source" "DailyTaskComplianceSource" NOT NULL,
    "expected_count" INTEGER NOT NULL,
    "completed_count" INTEGER NOT NULL,
    "missing_count" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notification_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_task_compliance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_task_compliance_user_id_team_id_work_date_content_line_id_source_key"
    ON "daily_task_compliance"("user_id", "team_id", "work_date", "content_line_id", "source");
CREATE INDEX IF NOT EXISTS "daily_task_compliance_work_date_idx"
    ON "daily_task_compliance"("work_date" DESC);
CREATE INDEX IF NOT EXISTS "daily_task_compliance_user_id_work_date_idx"
    ON "daily_task_compliance"("user_id", "work_date" DESC);
CREATE INDEX IF NOT EXISTS "daily_task_compliance_team_id_work_date_idx"
    ON "daily_task_compliance"("team_id", "work_date" DESC);
CREATE INDEX IF NOT EXISTS "daily_task_compliance_missing_count_notification_sent_at_idx"
    ON "daily_task_compliance"("missing_count", "notification_sent_at");

DO $$ BEGIN
    ALTER TABLE "daily_task_compliance" ADD CONSTRAINT "daily_task_compliance_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "daily_task_compliance" ADD CONSTRAINT "daily_task_compliance_team_id_fkey"
        FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "daily_task_compliance" ADD CONSTRAINT "daily_task_compliance_content_line_id_fkey"
        FOREIGN KEY ("content_line_id") REFERENCES "content_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
