-- =============================================================
-- SERVER CATCH-UP MIGRATION (idempotent – safe to run multiple times)
-- Chạy script này trên DB server để đồng bộ schema với local.
-- Sau khi chạy xong → gọi POST /api/lark/sync-channel và
-- POST /api/lark/sync-users để re-sync dữ liệu từ Lark.
-- =============================================================

-- ----------------------------------------------------------
-- 0. Đảm bảo UserRole enum có đủ giá trị ADMIN/MANAGER/MEMBER
-- ----------------------------------------------------------
DO $$
BEGIN
  -- Thêm MEMBER nếu chưa có
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'UserRole' AND e.enumlabel = 'MEMBER'
  ) THEN
    ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MEMBER';
  END IF;
END $$;

-- ----------------------------------------------------------
-- 1. Bảng role_permissions (nếu chưa có)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "role_permissions" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "menu_ids" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_role_key" ON "role_permissions"("role");

-- ----------------------------------------------------------
-- 2. Bảng report_outstanding (nếu chưa có)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "report_outstanding" (
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
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_outstanding_pkey" PRIMARY KEY ("id")
);

-- ----------------------------------------------------------
-- 3. Bảng lark_permissions (nếu chưa có)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "lark_permissions" (
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
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lark_permissions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "lark_permissions_email_idx" ON "lark_permissions"("email");
CREATE INDEX IF NOT EXISTS "lark_permissions_name_idx"  ON "lark_permissions"("name");

-- ----------------------------------------------------------
-- 4. Bảng lark_kpi (nếu chưa có)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "lark_kpi" (
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
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lark_kpi_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "lark_kpi_month_idx"       ON "lark_kpi"("month");
CREATE INDEX IF NOT EXISTS "lark_kpi_team_idx"        ON "lark_kpi"("team");
CREATE INDEX IF NOT EXISTS "lark_kpi_name_idx"        ON "lark_kpi"("name");
CREATE INDEX IF NOT EXISTS "lark_kpi_employee_id_idx" ON "lark_kpi"("employee_id");

-- ----------------------------------------------------------
-- 4b. Bảng lark_kpi_do_da — KPI Đồ Da (Lark wiki / Bitable riêng)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "lark_kpi_do_da" (
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
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lark_kpi_do_da_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "lark_kpi_do_da_month_idx" ON "lark_kpi_do_da"("month");
CREATE INDEX IF NOT EXISTS "lark_kpi_do_da_team_idx" ON "lark_kpi_do_da"("team");
CREATE INDEX IF NOT EXISTS "lark_kpi_do_da_name_idx" ON "lark_kpi_do_da"("name");
CREATE INDEX IF NOT EXISTS "lark_kpi_do_da_employee_id_idx" ON "lark_kpi_do_da"("employee_id");
CREATE INDEX IF NOT EXISTS "lark_kpi_do_da_report_date_team_idx" ON "lark_kpi_do_da"("report_date", "team");

-- ----------------------------------------------------------
-- 5. Bảng lark_report_kpi (nếu chưa có)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "lark_report_kpi" (
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
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lark_report_kpi_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "lark_report_kpi_report_date_idx" ON "lark_report_kpi"("report_date");
CREATE INDEX IF NOT EXISTS "lark_report_kpi_email_idx"       ON "lark_report_kpi"("email");
CREATE INDEX IF NOT EXISTS "lark_report_kpi_name_idx"        ON "lark_report_kpi"("name");

-- ----------------------------------------------------------
-- 6. Bảng lark_list_tasks (nếu chưa có)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "lark_list_tasks" (
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
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lark_list_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "lark_list_tasks_employee_id_idx"    ON "lark_list_tasks"("employee_id");
CREATE INDEX IF NOT EXISTS "lark_list_tasks_employee_email_idx" ON "lark_list_tasks"("employee_email");
CREATE INDEX IF NOT EXISTS "lark_list_tasks_team_idx"           ON "lark_list_tasks"("team");

-- ----------------------------------------------------------
-- 7. Bảng huyk_channels (nếu chưa có) + thêm cột email
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "huyk_channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "channel_id" TEXT,
    "link_channel" TEXT,
    "status" TEXT,
    "team_traffic" TEXT,
    "owner" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "huyk_channels_pkey" PRIMARY KEY ("id")
);
-- Cột email (migration 20260318150000)
ALTER TABLE "huyk_channels" ADD COLUMN IF NOT EXISTS "email" TEXT;

CREATE INDEX IF NOT EXISTS "huyk_channels_owner_idx"        ON "huyk_channels"("owner");
CREATE INDEX IF NOT EXISTS "huyk_channels_team_traffic_idx" ON "huyk_channels"("team_traffic");
CREATE INDEX IF NOT EXISTS "huyk_channels_email_idx"        ON "huyk_channels"("email");
CREATE INDEX IF NOT EXISTS "huyk_channels_email_status_idx" ON "huyk_channels"("email", "status");
CREATE INDEX IF NOT EXISTS "huyk_channels_platform_status_idx" ON "huyk_channels"("platform", "status");

-- ----------------------------------------------------------
-- 8. Cột mới trên bảng users
-- ----------------------------------------------------------
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "custom_permissions"      TEXT[]     DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lark_permissions"        JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_app_update_at"      TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roles"                   "UserRole"[] DEFAULT ARRAY[]::"UserRole"[];
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "team"                    TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "team_leader_id"          TEXT;
-- Từ migration merge lark_employee
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lark_employee_record_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_id"             TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "image_url"               TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_data"           JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_position"       TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_status"         TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_date"           TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "users_lark_employee_record_id_key" ON "users"("lark_employee_record_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_employee_id_key"             ON "users"("employee_id");
CREATE INDEX        IF NOT EXISTS "users_roles_idx"                   ON "users"("roles");
CREATE INDEX        IF NOT EXISTS "users_team_leader_id_idx"          ON "users"("team_leader_id");

-- ----------------------------------------------------------
-- 9. Cột mới trên bảng tracked_channels
-- ----------------------------------------------------------
ALTER TABLE "tracked_channels" ADD COLUMN IF NOT EXISTS "posts_count"      INTEGER;
ALTER TABLE "tracked_channels" ADD COLUMN IF NOT EXISTS "lark_channel_id"  TEXT;
ALTER TABLE "tracked_channels" ADD COLUMN IF NOT EXISTS "added_via"        TEXT NOT NULL DEFAULT 'manual';

CREATE UNIQUE INDEX IF NOT EXISTS "tracked_channels_lark_channel_id_key"
  ON "tracked_channels" ("lark_channel_id");
CREATE INDEX IF NOT EXISTS "tracked_channels_added_via_idx"
  ON "tracked_channels" ("added_via");
CREATE INDEX IF NOT EXISTS "tracked_channels_user_id_is_active_idx"
  ON "tracked_channels" ("user_id", "is_active");
CREATE INDEX IF NOT EXISTS "tracked_channels_user_id_platform_is_active_idx"
  ON "tracked_channels" ("user_id", "platform", "is_active");

-- ----------------------------------------------------------
-- 10. Cột mới trên bảng lark_traffic
-- ----------------------------------------------------------
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "date"            TIMESTAMP(3);
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "employee"        JSONB;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "team"            TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "month"           TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "traffic_fb"      BIGINT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "traffic_ig"      BIGINT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "traffic_lemon8"  BIGINT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "traffic_thread"  BIGINT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "traffic_tiktok"  BIGINT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "traffic_yt"      BIGINT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "traffic_zalo"    BIGINT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "total_traffic"   BIGINT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "is_confirmed"    TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "email"           TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "name"            TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "evidence_files"  TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "traffic_twitter" BIGINT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "evidence_fb"     TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "evidence_ig"     TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "evidence_tiktok" TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "evidence_yt"     TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "evidence_thread" TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "evidence_lemon8" TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "evidence_zalo"   TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "evidence_twitter" TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "channel_fb"      TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "channel_ig"      TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "channel_tiktok"  TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "channel_yt"      TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "channel_thread"  TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "channel_lemon8"  TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "channel_zalo"    TEXT;
ALTER TABLE "lark_traffic" ADD COLUMN IF NOT EXISTS "channel_twitter" TEXT;

CREATE INDEX IF NOT EXISTS "lark_traffic_month_idx" ON "lark_traffic"("month");
CREATE INDEX IF NOT EXISTS "lark_traffic_team_idx"  ON "lark_traffic"("team");
CREATE INDEX IF NOT EXISTS "lark_traffic_email_idx" ON "lark_traffic"("email");

-- ----------------------------------------------------------
-- 11. Copy avatar → image_url nếu cột avatar còn tồn tại
-- ----------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'avatar'
  ) THEN
    UPDATE "users" SET "image_url" = "avatar"
    WHERE "image_url" IS NULL AND "avatar" IS NOT NULL;
  END IF;
END $$;

-- ----------------------------------------------------------
-- 12. Sửa cột/index bị thiếu cho Social Publishing (social_accounts / social_posts)
-- ----------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'social_accounts'
  ) THEN
    ALTER TABLE "social_accounts" ADD COLUMN IF NOT EXISTS "is_shared" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "social_accounts" ADD COLUMN IF NOT EXISTS "parent_id" TEXT;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'social_accounts_parent_id_fkey'
    ) THEN
      ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "social_accounts"("id") ON DELETE SET NULL;
    END IF;
    
    CREATE INDEX IF NOT EXISTS "social_accounts_parent_id_idx"  ON "social_accounts"("parent_id");
    CREATE INDEX IF NOT EXISTS "social_accounts_is_shared_idx"  ON "social_accounts"("is_shared");
    CREATE INDEX IF NOT EXISTS "social_accounts_token_expires_at_idx" ON "social_accounts"("token_expires_at");
    CREATE INDEX IF NOT EXISTS "social_accounts_is_active_token_expires_at_idx" ON "social_accounts"("is_active", "token_expires_at");
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'social_posts'
  ) THEN
    CREATE INDEX IF NOT EXISTS "social_posts_status_scheduled_at_idx" ON "social_posts"("status", "scheduled_at");
    CREATE INDEX IF NOT EXISTS "social_posts_status_source_updated_at_idx" ON "social_posts"("status", "source", "updated_at");
  END IF;
END $$;

-- ----------------------------------------------------------
-- XONG – Chạy tiếp:
--   POST /api/lark/sync-users    ← đồng bộ nhân viên từ Lark
--   POST /api/lark/sync-channel  ← đồng bộ kênh từ Lark
-- ----------------------------------------------------------
