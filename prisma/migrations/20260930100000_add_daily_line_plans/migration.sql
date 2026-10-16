-- Kế hoạch ngày cho tuyến không tự tạo task (A1/A2/A3/A5): lượt chia 17:00 lưu chỉ tiêu ngày + gợi ý
-- content của từng người, editor tự tạo task từ gợi ý. Lưu bản chụp để gợi ý đứng yên trong ngày và
-- rải content cho cả team không trùng.

DO $$ BEGIN
    CREATE TYPE "DailyPlanSuggestionKind" AS ENUM ('CONTENT', 'WIN_VIDEO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "auto_assign_settings" ADD COLUMN IF NOT EXISTS "daily_plan_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "auto_assign_settings" ADD COLUMN IF NOT EXISTS "daily_plan_line_names" TEXT[] DEFAULT ARRAY['A1', 'A2', 'A3', 'A5']::TEXT[];

-- Content tạo nhanh từ video win: giữ link video gốc để editor xem lại, và để không gợi ý lại
-- video người đó đã lấy làm content.
ALTER TABLE "editor_contents" ADD COLUMN IF NOT EXISTS "reference_video_url" TEXT;
ALTER TABLE "editor_contents" ADD COLUMN IF NOT EXISTS "reference_video_post_id" TEXT;

CREATE TABLE IF NOT EXISTS "daily_line_plans" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "plan_date" DATE NOT NULL,
    "content_line_id" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "monthly_target" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_line_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "daily_line_plan_suggestions" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "kind" "DailyPlanSuggestionKind" NOT NULL,
    "rank" INTEGER NOT NULL,
    "content_id" TEXT,
    "team_content_id" TEXT,
    "editor_content_id" TEXT,
    "video_platform" TEXT,
    "video_post_id" TEXT,
    "video_url" TEXT,
    "video_caption" TEXT,
    "video_thumbnail_url" TEXT,
    "video_views" INTEGER,
    "video_published_at" TIMESTAMP(3),
    "video_page_name" TEXT,
    "used_at" TIMESTAMP(3),
    "task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_line_plan_suggestions_pkey" PRIMARY KEY ("id")
);

-- Lượt chia chạy lại trong ngày và GET /daily-plans/me đều lọc theo ngày kế hoạch.
CREATE INDEX IF NOT EXISTS "daily_line_plans_plan_date_idx" ON "daily_line_plans"("plan_date");
CREATE UNIQUE INDEX IF NOT EXISTS "daily_line_plans_user_id_team_id_plan_date_content_line_id_key"
    ON "daily_line_plans"("user_id", "team_id", "plan_date", "content_line_id");
CREATE UNIQUE INDEX IF NOT EXISTS "daily_line_plan_suggestions_task_id_key" ON "daily_line_plan_suggestions"("task_id");
CREATE INDEX IF NOT EXISTS "daily_line_plan_suggestions_plan_id_idx" ON "daily_line_plan_suggestions"("plan_id");

DO $$ BEGIN
    ALTER TABLE "daily_line_plans" ADD CONSTRAINT "daily_line_plans_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "daily_line_plans" ADD CONSTRAINT "daily_line_plans_team_id_fkey"
        FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "daily_line_plans" ADD CONSTRAINT "daily_line_plans_content_line_id_fkey"
        FOREIGN KEY ("content_line_id") REFERENCES "content_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "daily_line_plans" ADD CONSTRAINT "daily_line_plans_run_id_fkey"
        FOREIGN KEY ("run_id") REFERENCES "assignment_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "daily_line_plan_suggestions" ADD CONSTRAINT "daily_line_plan_suggestions_plan_id_fkey"
        FOREIGN KEY ("plan_id") REFERENCES "daily_line_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "daily_line_plan_suggestions" ADD CONSTRAINT "daily_line_plan_suggestions_content_id_fkey"
        FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "daily_line_plan_suggestions" ADD CONSTRAINT "daily_line_plan_suggestions_team_content_id_fkey"
        FOREIGN KEY ("team_content_id") REFERENCES "team_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "daily_line_plan_suggestions" ADD CONSTRAINT "daily_line_plan_suggestions_editor_content_id_fkey"
        FOREIGN KEY ("editor_content_id") REFERENCES "editor_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "daily_line_plan_suggestions" ADD CONSTRAINT "daily_line_plan_suggestions_task_id_fkey"
        FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
