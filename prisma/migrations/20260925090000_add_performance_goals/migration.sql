CREATE TYPE "PerformanceGoalType" AS ENUM ('KPI', 'OKR');
CREATE TYPE "PerformanceGoalMetricType" AS ENUM ('NUMBER', 'PERCENT', 'BOOLEAN');
CREATE TYPE "PerformanceGoalDirection" AS ENUM ('AT_LEAST', 'AT_MOST');
CREATE TYPE "PerformanceGoalStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "performance_goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "type" "PerformanceGoalType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metric_type" "PerformanceGoalMetricType" NOT NULL DEFAULT 'NUMBER',
    "unit" TEXT,
    "direction" "PerformanceGoalDirection" NOT NULL DEFAULT 'AT_LEAST',
    "target_value" DECIMAL(18,4) NOT NULL,
    "actual_system" DECIMAL(18,4),
    "actual_manual" DECIMAL(18,4),
    "pass_threshold_pct" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "status" "PerformanceGoalStatus" NOT NULL DEFAULT 'PUBLISHED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "set_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_goals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "performance_goal_histories" (
    "id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "change_reason" TEXT,
    "previous_data" JSONB,
    "next_data" JSONB NOT NULL,
    "changed_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_goal_histories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "performance_goals_team_id_month_status_idx"
    ON "performance_goals"("team_id", "month", "status");
CREATE INDEX "performance_goals_user_id_month_status_idx"
    ON "performance_goals"("user_id", "month", "status");
CREATE INDEX "performance_goals_updated_at_idx" ON "performance_goals"("updated_at");
CREATE UNIQUE INDEX "performance_goal_histories_goal_id_revision_key"
    ON "performance_goal_histories"("goal_id", "revision");
CREATE INDEX "performance_goal_histories_changed_by_id_idx"
    ON "performance_goal_histories"("changed_by_id");
CREATE INDEX "performance_goal_histories_created_at_idx"
    ON "performance_goal_histories"("created_at");

ALTER TABLE "performance_goals"
    ADD CONSTRAINT "performance_goals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_goals"
    ADD CONSTRAINT "performance_goals_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_goals"
    ADD CONSTRAINT "performance_goals_set_by_id_fkey"
    FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_goal_histories"
    ADD CONSTRAINT "performance_goal_histories_goal_id_fkey"
    FOREIGN KEY ("goal_id") REFERENCES "performance_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_goal_histories"
    ADD CONSTRAINT "performance_goal_histories_changed_by_id_fkey"
    FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
