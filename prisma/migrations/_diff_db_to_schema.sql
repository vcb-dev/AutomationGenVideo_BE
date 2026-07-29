-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ContentUsageStatus" AS ENUM ('AVAILABLE', 'IN_TASK', 'USED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentMarket" AS ENUM ('GLOBAL', 'VIETNAM');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('PRODUCT_STOCK', 'COLLECTED', 'OUTRO', 'WORKSHOP', 'HUYK');

-- CreateEnum
CREATE TYPE "KpiAllocationType" AS ENUM ('CONTENT_LINE', 'PRODUCT_LINE');

-- CreateEnum
CREATE TYPE "AssignmentOutcome" AS ENUM ('COMPLETED', 'OVERDUE', 'REASSIGNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('AUTO', 'EXTRA');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BrandType" AS ENUM ('DO_DA', 'TRANG_SUC');

-- CreateEnum
CREATE TYPE "TeamPushRequestType" AS ENUM ('PRODUCT', 'CONTENT');

-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'MANAGER', 'MEMBER', 'LEADER');
ALTER TABLE "users" ALTER COLUMN "roles" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "roles" TYPE "UserRole_new"[] USING ("roles"::text::"UserRole_new"[]);
ALTER TABLE "role_permissions" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TABLE "approved_content" ALTER COLUMN "approved_by_role" TYPE "UserRole_new" USING ("approved_by_role"::text::"UserRole_new");
ALTER TABLE "video_library" ALTER COLUMN "added_by_role" TYPE "UserRole_new" USING ("added_by_role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "users" ALTER COLUMN "roles" SET DEFAULT ARRAY[]::"UserRole"[];
COMMIT;

-- DropForeignKey
ALTER TABLE "authtoken_token" DROP CONSTRAINT "authtoken_token_user_id_35299eff_fk_auth_user_id";

-- DropForeignKey
ALTER TABLE "chat_audits" DROP CONSTRAINT "chat_audits_user_id_fkey";

-- DropForeignKey
ALTER TABLE "class_evaluations" DROP CONSTRAINT "class_evaluations_class_id_fkey";

-- DropForeignKey
ALTER TABLE "class_evaluations" DROP CONSTRAINT "class_evaluations_schedule_id_fkey";

-- DropForeignKey
ALTER TABLE "class_evaluations" DROP CONSTRAINT "class_evaluations_user_id_fkey";

-- DropForeignKey
ALTER TABLE "exam_attempts" DROP CONSTRAINT "exam_attempts_schedule_id_fkey";

-- DropForeignKey
ALTER TABLE "exam_attempts" DROP CONSTRAINT "exam_attempts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "exam_submissions" DROP CONSTRAINT "exam_submissions_class_id_fkey";

-- DropForeignKey
ALTER TABLE "exam_submissions" DROP CONSTRAINT "exam_submissions_schedule_id_fkey";

-- DropForeignKey
ALTER TABLE "exam_submissions" DROP CONSTRAINT "exam_submissions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "kpi_catalog_division_allowlist" DROP CONSTRAINT "kpi_catalog_division_allowlist_division_id_fkey";

-- DropForeignKey
ALTER TABLE "kpi_revenue_tiers" DROP CONSTRAINT "kpi_revenue_tiers_template_id_fkey";

-- DropForeignKey
ALTER TABLE "kpi_team_metric_templates" DROP CONSTRAINT "kpi_team_metric_templates_team_id_fkey";

-- DropForeignKey
ALTER TABLE "kpi_template_items" DROP CONSTRAINT "kpi_template_items_template_id_fkey";

-- DropForeignKey
ALTER TABLE "kpi_templates" DROP CONSTRAINT "kpi_templates_division_id_fkey";

-- DropForeignKey
ALTER TABLE "kpi_traffic_team_allowlist" DROP CONSTRAINT "kpi_traffic_team_allowlist_team_id_fkey";

-- DropForeignKey
ALTER TABLE "kpi_vinh_danh_configs" DROP CONSTRAINT "kpi_vinh_danh_configs_team_id_fkey";

-- DropForeignKey
ALTER TABLE "learning_class_members" DROP CONSTRAINT "learning_class_members_added_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "learning_class_members" DROP CONSTRAINT "learning_class_members_class_id_fkey";

-- DropForeignKey
ALTER TABLE "learning_class_members" DROP CONSTRAINT "learning_class_members_user_id_fkey";

-- DropForeignKey
ALTER TABLE "learning_class_schedules" DROP CONSTRAINT "learning_class_schedules_class_id_fkey";

-- DropForeignKey
ALTER TABLE "learning_class_schedules" DROP CONSTRAINT "learning_class_schedules_exam_teacher_user_id_fkey";

-- DropForeignKey
ALTER TABLE "learning_classes" DROP CONSTRAINT "learning_classes_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "learning_classes" DROP CONSTRAINT "learning_classes_teacher_user_id_fkey";

-- DropForeignKey
ALTER TABLE "learning_evidences" DROP CONSTRAINT "learning_evidences_user_id_fkey";

-- DropForeignKey
ALTER TABLE "meeting_bookings" DROP CONSTRAINT "meeting_bookings_user_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_answers" DROP CONSTRAINT "performance_answers_question_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_answers" DROP CONSTRAINT "performance_answers_respondent_user_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_assignments" DROP CONSTRAINT "performance_assignments_assignee_user_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_assignments" DROP CONSTRAINT "performance_assignments_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_assignments" DROP CONSTRAINT "performance_assignments_department_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_assignments" DROP CONSTRAINT "performance_assignments_team_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_assignments" DROP CONSTRAINT "performance_assignments_template_item_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_questionnaires" DROP CONSTRAINT "performance_questionnaires_team_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_questions" DROP CONSTRAINT "performance_questions_questionnaire_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_summaries" DROP CONSTRAINT "performance_summaries_assignee_user_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_summaries" DROP CONSTRAINT "performance_summaries_team_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_team_evaluations" DROP CONSTRAINT "performance_team_evaluations_evaluatee_user_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_team_evaluations" DROP CONSTRAINT "performance_team_evaluations_team_id_fkey";

-- DropForeignKey
ALTER TABLE "performance_window_configs" DROP CONSTRAINT "performance_window_configs_team_id_fkey";

-- DropForeignKey
ALTER TABLE "permission_assignments" DROP CONSTRAINT "permission_assignments_user_id_fkey";

-- DropForeignKey
ALTER TABLE "promotion_history" DROP CONSTRAINT "promotion_history_user_id_fkey";

-- DropForeignKey
ALTER TABLE "reward_penalty_rules" DROP CONSTRAINT "reward_penalty_rules_team_id_fkey";

-- DropForeignKey
ALTER TABLE "reward_records" DROP CONSTRAINT "reward_records_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "reward_records" DROP CONSTRAINT "reward_records_rule_id_fkey";

-- DropForeignKey
ALTER TABLE "reward_records" DROP CONSTRAINT "reward_records_source_assignment_id_fkey";

-- DropForeignKey
ALTER TABLE "reward_records" DROP CONSTRAINT "reward_records_user_id_fkey";

-- DropForeignKey
ALTER TABLE "scraper_tiktok_profile_metrics" DROP CONSTRAINT "scraper_tiktok_profile_metrics_profile_id_fkey";

-- DropForeignKey
ALTER TABLE "social_accounts" DROP CONSTRAINT "social_accounts_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "social_accounts" DROP CONSTRAINT "social_accounts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "social_drafts" DROP CONSTRAINT "social_drafts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "social_drive_upload_sessions" DROP CONSTRAINT "social_drive_upload_sessions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "social_oauth_states" DROP CONSTRAINT "social_oauth_states_user_id_fkey";

-- DropForeignKey
ALTER TABLE "social_posts" DROP CONSTRAINT "social_posts_account_id_fkey";

-- DropForeignKey
ALTER TABLE "social_posts" DROP CONSTRAINT "social_posts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "social_uploaded_files" DROP CONSTRAINT "social_uploaded_files_user_id_fkey";

-- DropForeignKey
ALTER TABLE "staff_general" DROP CONSTRAINT "staff_general_user_id_fkey";

-- DropForeignKey
ALTER TABLE "staff_highlight_achievements" DROP CONSTRAINT "staff_highlight_achievements_user_id_fkey";

-- DropForeignKey
ALTER TABLE "staff_probation" DROP CONSTRAINT "staff_probation_user_id_fkey";

-- DropForeignKey
ALTER TABLE "staff_proficient" DROP CONSTRAINT "staff_proficient_user_id_fkey";

-- DropForeignKey
ALTER TABLE "team_groups" DROP CONSTRAINT "team_groups_division_id_fkey";

-- DropForeignKey
ALTER TABLE "tracked_channels" DROP CONSTRAINT "tracked_channels_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_app_profiles" DROP CONSTRAINT "user_app_profiles_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_career_states" DROP CONSTRAINT "user_career_states_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_milestone_progress" DROP CONSTRAINT "user_milestone_progress_milestone_id_fkey";

-- DropForeignKey
ALTER TABLE "user_milestone_progress" DROP CONSTRAINT "user_milestone_progress_user_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_department_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_division_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_manager_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_team_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_team_leader_id_fkey";

-- DropForeignKey
ALTER TABLE "video_duplicates" DROP CONSTRAINT "video_duplicates_reviewed_by_fkey";

-- DropForeignKey
ALTER TABLE "videos" DROP CONSTRAINT "videos_user_id_fkey";

-- DropForeignKey
ALTER TABLE "work_report_late_requests" DROP CONSTRAINT "work_report_late_requests_requested_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "work_report_late_requests" DROP CONSTRAINT "work_report_late_requests_reviewed_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "work_report_late_requests" DROP CONSTRAINT "work_report_late_requests_work_report_id_fkey";

-- DropForeignKey
ALTER TABLE "work_reports" DROP CONSTRAINT "work_reports_reviewed_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "work_reports" DROP CONSTRAINT "work_reports_team_id_fkey";

-- DropForeignKey
ALTER TABLE "work_reports" DROP CONSTRAINT "work_reports_user_id_fkey";

-- DropIndex
DROP INDEX "scraper_search_keywords_is_google_active_last_searched_at_idx";

-- DropIndex
DROP INDEX "users_division_id_idx";

-- DropIndex
DROP INDEX "users_employee_code_primary_idx";

-- DropIndex
DROP INDEX "users_job_title_idx";

-- DropIndex
DROP INDEX "users_lark_record_id_key";

-- DropIndex
DROP INDEX "users_role_idx";

-- DropIndex
DROP INDEX "users_team_leader_id_idx";

-- AlterTable
ALTER TABLE "huyk_channels" ADD COLUMN     "owner_id" TEXT,
ADD COLUMN     "team_id" TEXT;

-- AlterTable
ALTER TABLE "scraper_facebook_reels" ADD COLUMN     "thumbnail_drive_url" TEXT;

-- AlterTable
ALTER TABLE "scraper_fanpages" DROP COLUMN "header_image_url",
ADD COLUMN     "avatar_drive_url" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "scraper_instagram_profiles" ADD COLUMN     "avatar_drive_url" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bio_links" JSONB,
ADD COLUMN     "biography" TEXT,
ADD COLUMN     "category" VARCHAR(255),
ADD COLUMN     "external_url" TEXT,
ADD COLUMN     "full_name" VARCHAR(500),
ADD COLUMN     "hd_avatar_url" TEXT,
ADD COLUMN     "instagram_id" VARCHAR(50),
ADD COLUMN     "is_business" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_owned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_private" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "scraper_instagram_reels" DROP COLUMN "views_count",
ADD COLUMN     "thumbnail_drive_url" TEXT;

-- AlterTable
ALTER TABLE "scraper_search_keywords" DROP COLUMN "is_google_active",
DROP COLUMN "raw_keyword";

-- AlterTable
ALTER TABLE "scraper_tiktok_profile_videos" DROP COLUMN "original_sound";

-- AlterTable
ALTER TABLE "scraper_tiktok_profiles" DROP COLUMN "account_created_at",
DROP COLUMN "avg_engagement_rate",
DROP COLUMN "comment_engagement_rate",
DROP COLUMN "is_commerce_user",
DROP COLUMN "like_engagement_rate",
DROP COLUMN "predicted_lang",
ADD COLUMN     "avatar_drive_url" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "is_owned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sec_uid" VARCHAR(255) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "scraper_tiktok_videos" DROP COLUMN "original_sound";

-- AlterTable
ALTER TABLE "social_accounts" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "user_id" SET DATA TYPE TEXT,
ALTER COLUMN "token_expires_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "social_drafts" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "user_id" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "social_drive_upload_sessions" ALTER COLUMN "user_id" SET DATA TYPE TEXT,
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "social_oauth_states" ALTER COLUMN "user_id" SET DATA TYPE TEXT,
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "social_posts" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "user_id" SET DATA TYPE TEXT,
ALTER COLUMN "scheduled_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "executed_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "next_retry_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "social_uploaded_files" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "user_id" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tracked_channels" ALTER COLUMN "user_id" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "users" DROP CONSTRAINT "users_pkey",
DROP COLUMN "address_current",
DROP COLUMN "address_household",
DROP COLUMN "admin_unit_code",
DROP COLUMN "attachment_id_back",
DROP COLUMN "attachment_id_front",
DROP COLUMN "avatar",
DROP COLUMN "bank_account_info",
DROP COLUMN "birth_date",
DROP COLUMN "birth_time",
DROP COLUMN "cccd_photo_link",
DROP COLUMN "children_info",
DROP COLUMN "confidentiality_agreement",
DROP COLUMN "custom_permissions",
DROP COLUMN "cv_attachment_ref",
DROP COLUMN "department_id",
DROP COLUMN "direct_manager",
DROP COLUMN "division_id",
DROP COLUMN "education_level",
DROP COLUMN "emergency_contact_1",
DROP COLUMN "employee_code_primary",
DROP COLUMN "employment_status",
DROP COLUMN "facebook_url",
DROP COLUMN "family_notes",
DROP COLUMN "father_guardian_contact",
DROP COLUMN "form_submitted_at",
DROP COLUMN "full_name_legal",
DROP COLUMN "gender",
DROP COLUMN "hometown_detail",
DROP COLUMN "hometown_new",
DROP COLUMN "identity_document_info",
DROP COLUMN "insurance_book_number",
DROP COLUMN "job_title",
DROP COLUMN "lark_permissions",
DROP COLUMN "lark_record_id",
DROP COLUMN "last_activity_at",
DROP COLUMN "last_app_update_at",
DROP COLUMN "last_login_at",
DROP COLUMN "last_synced_at",
DROP COLUMN "manager_block_code",
DROP COLUMN "manager_text",
DROP COLUMN "marital_status",
DROP COLUMN "mother_guardian_contact",
DROP COLUMN "phone_primary",
DROP COLUMN "profile_review_date",
DROP COLUMN "province_after_merger",
DROP COLUMN "raw_data",
DROP COLUMN "role",
DROP COLUMN "school_name",
DROP COLUMN "start_date_work",
DROP COLUMN "submitted_on_1",
DROP COLUMN "team_id",
DROP COLUMN "team_leader_id",
DROP COLUMN "team_order_number",
DROP COLUMN "total_action_count",
DROP COLUMN "total_login_count",
DROP COLUMN "vehicle_info",
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "email" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "full_name" SET NOT NULL,
ALTER COLUMN "full_name" DROP DEFAULT,
ALTER COLUMN "is_active" SET NOT NULL,
ALTER COLUMN "manager_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "video_duplicates" ALTER COLUMN "reviewed_by" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "video_management_managedfacebookpage" ADD COLUMN     "avatar_drive_url" TEXT;

-- AlterTable
ALTER TABLE "video_management_ownedvideocontent" ADD COLUMN     "thumbnail_drive_url" TEXT;

-- AlterTable
ALTER TABLE "videos" ALTER COLUMN "user_id" SET DATA TYPE TEXT;

-- DropTable
DROP TABLE "authtoken_token";

-- DropTable
DROP TABLE "chat_audits";

-- DropTable
DROP TABLE "class_evaluations";

-- DropTable
DROP TABLE "company_landing_pages";

-- DropTable
DROP TABLE "departments";

-- DropTable
DROP TABLE "divisions";

-- DropTable
DROP TABLE "exam_attempts";

-- DropTable
DROP TABLE "exam_submissions";

-- DropTable
DROP TABLE "kpi_catalog_division_allowlist";

-- DropTable
DROP TABLE "kpi_revenue_tiers";

-- DropTable
DROP TABLE "kpi_reward_thresholds";

-- DropTable
DROP TABLE "kpi_team_metric_templates";

-- DropTable
DROP TABLE "kpi_template_items";

-- DropTable
DROP TABLE "kpi_templates";

-- DropTable
DROP TABLE "kpi_traffic_team_allowlist";

-- DropTable
DROP TABLE "kpi_vinh_danh_configs";

-- DropTable
DROP TABLE "lark_kpi";

-- DropTable
DROP TABLE "lark_kpi_do_da";

-- DropTable
DROP TABLE "lark_kpi_do_da_editor";

-- DropTable
DROP TABLE "lark_kpi_global_indo";

-- DropTable
DROP TABLE "lark_list_tasks";

-- DropTable
DROP TABLE "lark_permissions";

-- DropTable
DROP TABLE "lark_report_kpi";

-- DropTable
DROP TABLE "lark_reports";

-- DropTable
DROP TABLE "lark_traffic";

-- DropTable
DROP TABLE "learning_class_members";

-- DropTable
DROP TABLE "learning_class_schedules";

-- DropTable
DROP TABLE "learning_classes";

-- DropTable
DROP TABLE "learning_evidences";

-- DropTable
DROP TABLE "learning_milestones";

-- DropTable
DROP TABLE "meeting_bookings";

-- DropTable
DROP TABLE "performance_answers";

-- DropTable
DROP TABLE "performance_assignments";

-- DropTable
DROP TABLE "performance_questionnaires";

-- DropTable
DROP TABLE "performance_questions";

-- DropTable
DROP TABLE "performance_summaries";

-- DropTable
DROP TABLE "performance_team_evaluations";

-- DropTable
DROP TABLE "performance_window_configs";

-- DropTable
DROP TABLE "permission_assignments";

-- DropTable
DROP TABLE "promotion_history";

-- DropTable
DROP TABLE "reward_penalty_rules";

-- DropTable
DROP TABLE "reward_records";

-- DropTable
DROP TABLE "role_email_overrides";

-- DropTable
DROP TABLE "sapo_scraper_sessions";

-- DropTable
DROP TABLE "scraper_tiktok_profile_metrics";

-- DropTable
DROP TABLE "staff_general";

-- DropTable
DROP TABLE "staff_highlight_achievements";

-- DropTable
DROP TABLE "staff_level_roadmap_items";

-- DropTable
DROP TABLE "staff_probation";

-- DropTable
DROP TABLE "staff_proficient";

-- DropTable
DROP TABLE "team_groups";

-- DropTable
DROP TABLE "user_app_profiles";

-- DropTable
DROP TABLE "user_career_states";

-- DropTable
DROP TABLE "user_milestone_progress";

-- DropTable
DROP TABLE "work_report_late_requests";

-- DropTable
DROP TABLE "work_reports";

-- DropEnum
DROP TYPE "CareerLevel";

-- DropEnum
DROP TYPE "ClassStatus";

-- DropEnum
DROP TYPE "ExamOutcome";

-- DropEnum
DROP TYPE "ExamSubmissionStatus";

-- DropEnum
DROP TYPE "MeetingBookingStatus";

-- DropEnum
DROP TYPE "MilestoneStatus";

-- DropEnum
DROP TYPE "PerformanceAssignmentStatus";

-- DropEnum
DROP TYPE "PerformanceItemKind";

-- DropEnum
DROP TYPE "UserAppRole";

-- DropEnum
DROP TYPE "WorkReportStatus";

-- CreateTable
CREATE TABLE "checklist_reports" (
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

    CONSTRAINT "checklist_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi" (
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

    CONSTRAINT "kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_do_da" (
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

    CONSTRAINT "kpi_do_da_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_global_indo" (
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

    CONSTRAINT "kpi_global_indo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_do_da_editor" (
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

    CONSTRAINT "kpi_do_da_editor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traffic_reports" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "employee" JSONB,
    "team" TEXT,
    "month" TEXT,
    "traffic_fb" BIGINT,
    "traffic_ig" BIGINT,
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
    "email" TEXT,
    "evidence_fb" TEXT,
    "evidence_ig" TEXT,
    "evidence_tiktok" TEXT,
    "evidence_yt" TEXT,
    "evidence_thread" TEXT,
    "evidence_zalo" TEXT,
    "channel_fb" TEXT,
    "channel_ig" TEXT,
    "channel_tiktok" TEXT,
    "channel_yt" TEXT,
    "channel_thread" TEXT,
    "channel_zalo" TEXT,

    CONSTRAINT "traffic_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_permissions" (
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

    CONSTRAINT "report_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_kpi" (
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

    CONSTRAINT "report_kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reported_tasks" (
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

    CONSTRAINT "reported_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_douyin_videos" (
    "id" BIGSERIAL NOT NULL,
    "post_id" VARCHAR(50) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preview_image" TEXT,
    "video_duration" INTEGER NOT NULL DEFAULT 0,
    "region" VARCHAR(10) NOT NULL DEFAULT '',
    "author_id" VARCHAR(50) NOT NULL DEFAULT '',
    "author_username" VARCHAR(255) NOT NULL DEFAULT '',
    "author_display_name" VARCHAR(500) NOT NULL DEFAULT '',
    "author_avatar" TEXT,
    "author_followers" BIGINT NOT NULL DEFAULT 0,
    "author_is_verified" BOOLEAN NOT NULL DEFAULT false,
    "digg_count" BIGINT NOT NULL DEFAULT 0,
    "comment_count" BIGINT NOT NULL DEFAULT 0,
    "share_count" BIGINT NOT NULL DEFAULT 0,
    "collect_count" BIGINT NOT NULL DEFAULT 0,
    "music_title" VARCHAR(500) NOT NULL DEFAULT '',
    "music_author" VARCHAR(255) NOT NULL DEFAULT '',
    "search_keyword" VARCHAR(500) NOT NULL DEFAULT '',
    "date_posted" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_douyin_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_douyin_profiles" (
    "id" BIGSERIAL NOT NULL,
    "sec_user_id" VARCHAR(255) NOT NULL,
    "uid" VARCHAR(50) NOT NULL DEFAULT '',
    "username" VARCHAR(255) NOT NULL DEFAULT '',
    "nickname" VARCHAR(500) NOT NULL DEFAULT '',
    "avatar_url" TEXT NOT NULL DEFAULT '',
    "avatar_drive_url" TEXT NOT NULL DEFAULT '',
    "biography" TEXT NOT NULL DEFAULT '',
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "is_bookmarked" BOOLEAN NOT NULL DEFAULT false,
    "is_tracked" BOOLEAN NOT NULL DEFAULT false,
    "is_owned" BOOLEAN NOT NULL DEFAULT false,
    "is_initial_scraped" BOOLEAN NOT NULL DEFAULT false,
    "last_scraped_at" TIMESTAMPTZ(6),
    "scraping_status" VARCHAR(20) NOT NULL DEFAULT 'idle',
    "scrape_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_douyin_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_xiaohongshu_videos" (
    "id" BIGSERIAL NOT NULL,
    "note_id" VARCHAR(50) NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "title" VARCHAR(1000) NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "thumbnail_url" TEXT,
    "thumbnail_drive_url" TEXT,
    "author_id" VARCHAR(100) NOT NULL DEFAULT '',
    "author_name" VARCHAR(500) NOT NULL DEFAULT '',
    "author_avatar" TEXT,
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "liked_count" BIGINT NOT NULL DEFAULT 0,
    "collected_count" BIGINT NOT NULL DEFAULT 0,
    "comments_count" BIGINT NOT NULL DEFAULT 0,
    "shared_count" BIGINT NOT NULL DEFAULT 0,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "date_posted" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "profile_id" BIGINT,

    CONSTRAINT "scraper_xiaohongshu_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_xiaohongshu_profiles" (
    "id" BIGSERIAL NOT NULL,
    "user_id" VARCHAR(100) NOT NULL,
    "nickname" VARCHAR(500) NOT NULL DEFAULT '',
    "avatar_url" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_tracked" BOOLEAN NOT NULL DEFAULT true,
    "is_bookmarked" BOOLEAN NOT NULL DEFAULT false,
    "is_owned" BOOLEAN NOT NULL DEFAULT false,
    "is_initial_scraped" BOOLEAN NOT NULL DEFAULT false,
    "last_scraped_at" TIMESTAMPTZ(6),
    "scraping_status" VARCHAR(20) NOT NULL DEFAULT 'idle',
    "scrape_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_xiaohongshu_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leader_id" TEXT,
    "brand_type" "BrandType" NOT NULL DEFAULT 'TRANG_SUC',
    "market" TEXT NOT NULL DEFAULT 'VIETNAM',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_products" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT,
    "brand_type" "BrandType" NOT NULL DEFAULT 'DO_DA',
    "image_url" TEXT,
    "image_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price" DECIMAL(15,2),
    "market" TEXT,
    "price_segment" TEXT,
    "priority_score" INTEGER NOT NULL DEFAULT 0,
    "material_id" TEXT,
    "product_line_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source_editor_product_id" TEXT,
    "source_product_id" TEXT,
    "added_by_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_contents" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "brand_type" "BrandType" NOT NULL DEFAULT 'DO_DA',
    "market" TEXT NOT NULL DEFAULT 'VIETNAM',
    "title" TEXT,
    "body" TEXT,
    "script" TEXT,
    "file_content_url" TEXT,
    "voice_url" TEXT,
    "content_line_id" TEXT,
    "status" "ContentUsageStatus" NOT NULL DEFAULT 'AVAILABLE',
    "source_editor_content_id" TEXT,
    "source_content_id" TEXT,
    "added_by_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_sources" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "brand_type" "BrandType" NOT NULL DEFAULT 'DO_DA',
    "type" "SourceType",
    "name" TEXT,
    "link" TEXT,
    "nas_link" TEXT,
    "code" TEXT,
    "product_id" TEXT,
    "team_product_id" TEXT,
    "source_editor_source_id" TEXT,
    "source_source_id" TEXT,
    "added_by_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editor_products" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand_type" "BrandType" NOT NULL DEFAULT 'DO_DA',
    "image_url" TEXT,
    "image_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price" DECIMAL(15,2),
    "market" TEXT,
    "price_segment" TEXT,
    "priority_score" INTEGER NOT NULL DEFAULT 0,
    "material_id" TEXT,
    "product_line_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source_product_id" TEXT,
    "added_by_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editor_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editor_contents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "brand_type" "BrandType" NOT NULL DEFAULT 'DO_DA',
    "market" TEXT NOT NULL DEFAULT 'VIETNAM',
    "title" TEXT,
    "body" TEXT,
    "script" TEXT,
    "file_content_url" TEXT,
    "voice_url" TEXT,
    "content_line_id" TEXT,
    "status" "ContentUsageStatus" NOT NULL DEFAULT 'AVAILABLE',
    "source_content_id" TEXT,
    "added_by_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editor_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editor_sources" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "brand_type" "BrandType" NOT NULL DEFAULT 'DO_DA',
    "type" "SourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "nas_link" TEXT,
    "code" TEXT,
    "product_id" TEXT,
    "editor_product_id" TEXT,
    "source_source_id" TEXT,
    "added_by_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editor_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_push_requests" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "type" "TeamPushRequestType" NOT NULL,
    "editor_product_id" TEXT,
    "editor_content_id" TEXT,
    "requested_by_id" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_push_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editor_approvals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "editor_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_kpis" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_kpis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_kpi_allocations" (
    "id" TEXT NOT NULL,
    "team_kpi_id" TEXT NOT NULL,
    "type" "KpiAllocationType" NOT NULL,
    "content_line_id" TEXT,
    "product_line_id" TEXT,
    "percent" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "team_kpi_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editor_kpis" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "team_id" TEXT,
    "month" TEXT NOT NULL,
    "total_target" INTEGER NOT NULL DEFAULT 0,
    "video_win" INTEGER NOT NULL DEFAULT 0,
    "video_fail" INTEGER NOT NULL DEFAULT 0,
    "kpi_extra" INTEGER NOT NULL DEFAULT 0,
    "content_new" INTEGER NOT NULL DEFAULT 0,
    "content_collected" INTEGER NOT NULL DEFAULT 0,
    "content_win_cover" INTEGER NOT NULL DEFAULT 0,
    "product_planned" INTEGER NOT NULL DEFAULT 0,
    "product_win_collect" INTEGER NOT NULL DEFAULT 0,
    "set_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editor_kpis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editor_kpi_allocations" (
    "id" TEXT NOT NULL,
    "editor_kpi_id" TEXT NOT NULL,
    "type" "KpiAllocationType" NOT NULL,
    "content_line_id" TEXT,
    "product_line_id" TEXT,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "editor_kpi_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_lines" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "a_type" TEXT,

    CONSTRAINT "content_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_lines" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "video_category" TEXT,

    CONSTRAINT "product_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand_type" "BrandType" NOT NULL DEFAULT 'DO_DA',

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT,
    "brand_type" "BrandType" NOT NULL DEFAULT 'DO_DA',
    "image_url" TEXT,
    "image_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price" DECIMAL(15,2),
    "market" TEXT,
    "price_segment" TEXT,
    "priority_score" INTEGER NOT NULL DEFAULT 0,
    "material_id" TEXT,
    "product_line_id" TEXT,
    "added_by_id" TEXT NOT NULL,
    "lark_record_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source_team_product_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contents" (
    "id" TEXT NOT NULL,
    "brand_type" "BrandType" NOT NULL DEFAULT 'DO_DA',
    "market" "ContentMarket" NOT NULL DEFAULT 'VIETNAM',
    "title" TEXT,
    "body" TEXT,
    "script" TEXT,
    "file_content_url" TEXT,
    "voice_url" TEXT,
    "voice_id" BIGINT,
    "content_line_id" TEXT,
    "status" "ContentUsageStatus" NOT NULL DEFAULT 'AVAILABLE',
    "view_count" BIGINT NOT NULL DEFAULT 0,
    "approved_content_id" TEXT,
    "added_by_id" TEXT NOT NULL,
    "lark_record_id" TEXT,
    "source_team_content_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "brand_type" "BrandType" NOT NULL DEFAULT 'DO_DA',
    "type" "SourceType",
    "name" TEXT,
    "link" TEXT,
    "nas_link" TEXT,
    "code" TEXT,
    "product_id" TEXT,
    "added_by_id" TEXT NOT NULL,
    "lark_record_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source_team_source_id" TEXT,
    "ordered_team_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "content_id" TEXT,
    "product_id" TEXT,
    "editor_product_id" TEXT,
    "team_product_id" TEXT,
    "editor_content_id" TEXT,
    "team_content_id" TEXT,
    "content_line_id" TEXT,
    "product_line_id" TEXT,
    "source_outro_id" TEXT,
    "source_extra_id" TEXT,
    "source_workshop_id" TEXT,
    "source_huyk_id" TEXT,
    "editor_source_outro_id" TEXT,
    "editor_source_extra_id" TEXT,
    "editor_source_workshop_id" TEXT,
    "editor_source_huyk_id" TEXT,
    "team_source_outro_id" TEXT,
    "team_source_extra_id" TEXT,
    "team_source_workshop_id" TEXT,
    "team_source_huyk_id" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "brand_type" "BrandType",
    "task_type" "TaskType" NOT NULL DEFAULT 'EXTRA',
    "is_product_push" BOOLEAN NOT NULL DEFAULT false,
    "assignee_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "run_id" TEXT,
    "result_url" TEXT,
    "submitted_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "lark_record_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_pending_videos" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "uploader_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalname" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "url" TEXT NOT NULL,
    "storage" TEXT NOT NULL DEFAULT 'local',
    "drive_file_id" TEXT,
    "web_view_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_pending_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignments" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3) NOT NULL,
    "outcome" "AssignmentOutcome",
    "run_id" TEXT,
    "note" TEXT,

    CONSTRAINT "task_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_runs" (
    "id" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AssignmentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "total_assigned" INTEGER NOT NULL DEFAULT 0,
    "total_skipped" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "error_msg" TEXT,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "assignment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_assign_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "schedule_time" TEXT NOT NULL DEFAULT '17:00',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "weekend_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_assign_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "task_id" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_warehouses" (
    "product_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,

    CONSTRAINT "product_warehouses_pkey" PRIMARY KEY ("product_id","month")
);

-- CreateTable
CREATE TABLE "content_warehouses" (
    "content_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,

    CONSTRAINT "content_warehouses_pkey" PRIMARY KEY ("content_id","month")
);

-- CreateTable
CREATE TABLE "source_warehouses" (
    "source_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,

    CONSTRAINT "source_warehouses_pkey" PRIMARY KEY ("source_id","month")
);

-- CreateTable
CREATE TABLE "team_product_warehouses" (
    "team_product_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,

    CONSTRAINT "team_product_warehouses_pkey" PRIMARY KEY ("team_product_id","month")
);

-- CreateTable
CREATE TABLE "team_content_warehouses" (
    "team_content_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,

    CONSTRAINT "team_content_warehouses_pkey" PRIMARY KEY ("team_content_id","month")
);

-- CreateTable
CREATE TABLE "team_source_warehouses" (
    "team_source_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,

    CONSTRAINT "team_source_warehouses_pkey" PRIMARY KEY ("team_source_id","month")
);

-- CreateTable
CREATE TABLE "editor_product_warehouses" (
    "editor_product_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,

    CONSTRAINT "editor_product_warehouses_pkey" PRIMARY KEY ("editor_product_id","month")
);

-- CreateTable
CREATE TABLE "editor_content_warehouses" (
    "editor_content_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,

    CONSTRAINT "editor_content_warehouses_pkey" PRIMARY KEY ("editor_content_id","month")
);

-- CreateTable
CREATE TABLE "editor_source_warehouses" (
    "editor_source_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,

    CONSTRAINT "editor_source_warehouses_pkey" PRIMARY KEY ("editor_source_id","month")
);

-- CreateIndex
CREATE INDEX "checklist_reports_date_idx" ON "checklist_reports"("date");

-- CreateIndex
CREATE INDEX "checklist_reports_date_team_idx" ON "checklist_reports"("date", "team");

-- CreateIndex
CREATE INDEX "checklist_reports_email_idx" ON "checklist_reports"("email");

-- CreateIndex
CREATE INDEX "checklist_reports_name_idx" ON "checklist_reports"("name");

-- CreateIndex
CREATE INDEX "kpi_month_idx" ON "kpi"("month");

-- CreateIndex
CREATE INDEX "kpi_report_date_team_idx" ON "kpi"("report_date", "team");

-- CreateIndex
CREATE INDEX "kpi_state_month_team_idx" ON "kpi"("state", "month", "team");

-- CreateIndex
CREATE INDEX "kpi_team_idx" ON "kpi"("team");

-- CreateIndex
CREATE INDEX "kpi_name_idx" ON "kpi"("name");

-- CreateIndex
CREATE INDEX "kpi_employee_id_idx" ON "kpi"("employee_id");

-- CreateIndex
CREATE INDEX "kpi_report_date_idx" ON "kpi"("report_date" DESC);

-- CreateIndex
CREATE INDEX "kpi_do_da_month_idx" ON "kpi_do_da"("month");

-- CreateIndex
CREATE INDEX "kpi_do_da_report_date_team_idx" ON "kpi_do_da"("report_date", "team");

-- CreateIndex
CREATE INDEX "kpi_do_da_team_idx" ON "kpi_do_da"("team");

-- CreateIndex
CREATE INDEX "kpi_do_da_name_idx" ON "kpi_do_da"("name");

-- CreateIndex
CREATE INDEX "kpi_do_da_employee_id_idx" ON "kpi_do_da"("employee_id");

-- CreateIndex
CREATE INDEX "kpi_global_indo_month_idx" ON "kpi_global_indo"("month");

-- CreateIndex
CREATE INDEX "kpi_global_indo_report_date_idx" ON "kpi_global_indo"("report_date");

-- CreateIndex
CREATE INDEX "kpi_do_da_editor_report_date_idx" ON "kpi_do_da_editor"("report_date");

-- CreateIndex
CREATE INDEX "kpi_do_da_editor_report_date_key_team_idx" ON "kpi_do_da_editor"("report_date_key", "team");

-- CreateIndex
CREATE INDEX "kpi_do_da_editor_editor_name_idx" ON "kpi_do_da_editor"("editor_name");

-- CreateIndex
CREATE INDEX "kpi_do_da_editor_editor_name_key_month_idx" ON "kpi_do_da_editor"("editor_name_key", "month");

-- CreateIndex
CREATE INDEX "traffic_reports_date_idx" ON "traffic_reports"("date");

-- CreateIndex
CREATE INDEX "traffic_reports_date_team_idx" ON "traffic_reports"("date", "team");

-- CreateIndex
CREATE INDEX "traffic_reports_month_idx" ON "traffic_reports"("month");

-- CreateIndex
CREATE INDEX "traffic_reports_team_idx" ON "traffic_reports"("team");

-- CreateIndex
CREATE INDEX "traffic_reports_email_idx" ON "traffic_reports"("email");

-- CreateIndex
CREATE INDEX "report_permissions_email_idx" ON "report_permissions"("email");

-- CreateIndex
CREATE INDEX "report_permissions_name_idx" ON "report_permissions"("name");

-- CreateIndex
CREATE INDEX "report_kpi_report_date_idx" ON "report_kpi"("report_date");

-- CreateIndex
CREATE INDEX "report_kpi_report_date_team_idx" ON "report_kpi"("report_date", "team");

-- CreateIndex
CREATE INDEX "report_kpi_email_idx" ON "report_kpi"("email");

-- CreateIndex
CREATE INDEX "report_kpi_name_idx" ON "report_kpi"("name");

-- CreateIndex
CREATE INDEX "reported_tasks_employee_id_idx" ON "reported_tasks"("employee_id");

-- CreateIndex
CREATE INDEX "reported_tasks_employee_email_idx" ON "reported_tasks"("employee_email");

-- CreateIndex
CREATE INDEX "reported_tasks_team_idx" ON "reported_tasks"("team");

-- CreateIndex
CREATE UNIQUE INDEX "scraper_douyin_videos_post_id_key" ON "scraper_douyin_videos"("post_id");

-- CreateIndex
CREATE INDEX "scraper_douyin_videos_author_id_idx" ON "scraper_douyin_videos"("author_id");

-- CreateIndex
CREATE INDEX "scraper_douyin_videos_date_posted_idx" ON "scraper_douyin_videos"("date_posted" DESC);

-- CreateIndex
CREATE INDEX "scraper_douyin_videos_search_keyword_idx" ON "scraper_douyin_videos"("search_keyword");

-- CreateIndex
CREATE UNIQUE INDEX "scraper_douyin_profiles_sec_user_id_key" ON "scraper_douyin_profiles"("sec_user_id");

-- CreateIndex
CREATE INDEX "scraper_douyin_profiles_uid_idx" ON "scraper_douyin_profiles"("uid");

-- CreateIndex
CREATE INDEX "scraper_douyin_profiles_username_idx" ON "scraper_douyin_profiles"("username");

-- CreateIndex
CREATE INDEX "scraper_douyin_profiles_is_tracked_last_scraped_at_idx" ON "scraper_douyin_profiles"("is_tracked", "last_scraped_at");

-- CreateIndex
CREATE INDEX "scraper_douyin_profiles_is_bookmarked_idx" ON "scraper_douyin_profiles"("is_bookmarked");

-- CreateIndex
CREATE INDEX "scraper_douyin_profiles_is_owned_idx" ON "scraper_douyin_profiles"("is_owned");

-- CreateIndex
CREATE INDEX "scraper_douyin_profiles_followers_count_idx" ON "scraper_douyin_profiles"("followers_count" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_xiaohongshu_videos_note_id_key" ON "scraper_xiaohongshu_videos"("note_id");

-- CreateIndex
CREATE INDEX "scraper_xiaohongshu_videos_liked_count_idx" ON "scraper_xiaohongshu_videos"("liked_count" DESC);

-- CreateIndex
CREATE INDEX "scraper_xiaohongshu_videos_date_posted_idx" ON "scraper_xiaohongshu_videos"("date_posted" DESC);

-- CreateIndex
CREATE INDEX "scraper_xiaohongshu_videos_profile_id_idx" ON "scraper_xiaohongshu_videos"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "scraper_xiaohongshu_profiles_user_id_key" ON "scraper_xiaohongshu_profiles"("user_id");

-- CreateIndex
CREATE INDEX "scraper_xiaohongshu_profiles_is_tracked_idx" ON "scraper_xiaohongshu_profiles"("is_tracked");

-- CreateIndex
CREATE INDEX "scraper_xiaohongshu_profiles_is_owned_idx" ON "scraper_xiaohongshu_profiles"("is_owned");

-- CreateIndex
CREATE INDEX "scraper_xiaohongshu_profiles_scraping_status_idx" ON "scraper_xiaohongshu_profiles"("scraping_status");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE INDEX "teams_leader_id_idx" ON "teams"("leader_id");

-- CreateIndex
CREATE INDEX "team_members_user_id_idx" ON "team_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_team_id_user_id_key" ON "team_members"("team_id", "user_id");

-- CreateIndex
CREATE INDEX "team_products_team_id_is_active_idx" ON "team_products"("team_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "team_products_team_id_source_editor_product_id_key" ON "team_products"("team_id", "source_editor_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_contents_team_id_source_editor_content_id_key" ON "team_contents"("team_id", "source_editor_content_id");

-- CreateIndex
CREATE INDEX "team_sources_team_id_is_active_idx" ON "team_sources"("team_id", "is_active");

-- CreateIndex
CREATE INDEX "team_sources_team_product_id_idx" ON "team_sources"("team_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_sources_team_id_source_editor_source_id_key" ON "team_sources"("team_id", "source_editor_source_id");

-- CreateIndex
CREATE INDEX "editor_products_user_id_is_active_idx" ON "editor_products"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "editor_sources_editor_product_id_idx" ON "editor_sources"("editor_product_id");

-- CreateIndex
CREATE INDEX "team_push_requests_team_id_status_idx" ON "team_push_requests"("team_id", "status");

-- CreateIndex
CREATE INDEX "team_push_requests_requested_by_id_idx" ON "team_push_requests"("requested_by_id");

-- CreateIndex
CREATE INDEX "team_kpis_month_idx" ON "team_kpis"("month");

-- CreateIndex
CREATE UNIQUE INDEX "team_kpis_team_id_month_key" ON "team_kpis"("team_id", "month");

-- CreateIndex
CREATE INDEX "team_kpi_allocations_team_kpi_id_idx" ON "team_kpi_allocations"("team_kpi_id");

-- CreateIndex
CREATE INDEX "team_kpi_allocations_content_line_id_idx" ON "team_kpi_allocations"("content_line_id");

-- CreateIndex
CREATE INDEX "team_kpi_allocations_product_line_id_idx" ON "team_kpi_allocations"("product_line_id");

-- CreateIndex
CREATE INDEX "editor_kpis_month_idx" ON "editor_kpis"("month");

-- CreateIndex
CREATE INDEX "editor_kpis_team_id_idx" ON "editor_kpis"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "editor_kpis_user_id_team_id_month_key" ON "editor_kpis"("user_id", "team_id", "month");

-- CreateIndex
CREATE INDEX "editor_kpi_allocations_editor_kpi_id_idx" ON "editor_kpi_allocations"("editor_kpi_id");

-- CreateIndex
CREATE INDEX "editor_kpi_allocations_content_line_id_idx" ON "editor_kpi_allocations"("content_line_id");

-- CreateIndex
CREATE INDEX "editor_kpi_allocations_product_line_id_idx" ON "editor_kpi_allocations"("product_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_lines_name_key" ON "content_lines"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_lines_name_key" ON "product_lines"("name");

-- CreateIndex
CREATE UNIQUE INDEX "materials_name_brand_type_key" ON "materials"("name", "brand_type");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_lark_record_id_key" ON "products"("lark_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_source_team_product_id_key" ON "products"("source_team_product_id");

-- CreateIndex
CREATE INDEX "products_product_line_id_idx" ON "products"("product_line_id");

-- CreateIndex
CREATE INDEX "products_priority_score_idx" ON "products"("priority_score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "contents_lark_record_id_key" ON "contents"("lark_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "contents_source_team_content_id_key" ON "contents"("source_team_content_id");

-- CreateIndex
CREATE INDEX "contents_added_by_id_idx" ON "contents"("added_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "sources_lark_record_id_key" ON "sources"("lark_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "sources_source_team_source_id_key" ON "sources"("source_team_source_id");

-- CreateIndex
CREATE INDEX "sources_product_id_is_active_idx" ON "sources"("product_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_lark_record_id_key" ON "tasks"("lark_record_id");

-- CreateIndex
CREATE INDEX "tasks_run_id_idx" ON "tasks"("run_id");

-- CreateIndex
CREATE INDEX "tasks_assignee_id_team_id_assigned_at_idx" ON "tasks"("assignee_id", "team_id", "assigned_at");

-- CreateIndex
CREATE INDEX "tasks_content_id_idx" ON "tasks"("content_id");

-- CreateIndex
CREATE INDEX "tasks_product_id_idx" ON "tasks"("product_id");

-- CreateIndex
CREATE INDEX "tasks_editor_product_id_idx" ON "tasks"("editor_product_id");

-- CreateIndex
CREATE INDEX "tasks_team_product_id_idx" ON "tasks"("team_product_id");

-- CreateIndex
CREATE INDEX "tasks_editor_content_id_idx" ON "tasks"("editor_content_id");

-- CreateIndex
CREATE INDEX "tasks_team_content_id_idx" ON "tasks"("team_content_id");

-- CreateIndex
CREATE INDEX "tasks_content_line_id_idx" ON "tasks"("content_line_id");

-- CreateIndex
CREATE INDEX "tasks_product_line_id_idx" ON "tasks"("product_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_pending_videos_task_id_key" ON "task_pending_videos"("task_id");

-- CreateIndex
CREATE INDEX "task_assignments_task_id_idx" ON "task_assignments"("task_id");

-- CreateIndex
CREATE INDEX "task_assignments_user_id_assigned_at_idx" ON "task_assignments"("user_id", "assigned_at");

-- CreateIndex
CREATE INDEX "task_assignments_run_id_idx" ON "task_assignments"("run_id");

-- CreateIndex
CREATE INDEX "assignment_runs_run_at_idx" ON "assignment_runs"("run_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_expires_at_idx" ON "notifications"("expires_at");

-- CreateIndex
CREATE INDEX "product_warehouses_month_idx" ON "product_warehouses"("month");

-- CreateIndex
CREATE INDEX "content_warehouses_month_idx" ON "content_warehouses"("month");

-- CreateIndex
CREATE INDEX "source_warehouses_month_idx" ON "source_warehouses"("month");

-- CreateIndex
CREATE INDEX "team_product_warehouses_month_idx" ON "team_product_warehouses"("month");

-- CreateIndex
CREATE INDEX "team_content_warehouses_month_idx" ON "team_content_warehouses"("month");

-- CreateIndex
CREATE INDEX "team_source_warehouses_month_idx" ON "team_source_warehouses"("month");

-- CreateIndex
CREATE INDEX "editor_product_warehouses_month_idx" ON "editor_product_warehouses"("month");

-- CreateIndex
CREATE INDEX "editor_content_warehouses_month_idx" ON "editor_content_warehouses"("month");

-- CreateIndex
CREATE INDEX "editor_source_warehouses_month_idx" ON "editor_source_warehouses"("month");

-- CreateIndex
CREATE INDEX "huyk_channels_owner_id_idx" ON "huyk_channels"("owner_id");

-- CreateIndex
CREATE INDEX "huyk_channels_team_id_idx" ON "huyk_channels"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "scraper_instagram_profiles_instagram_id_key" ON "scraper_instagram_profiles"("instagram_id");

-- CreateIndex
CREATE INDEX "scraper_instagram_profiles_is_owned_idx" ON "scraper_instagram_profiles"("is_owned");

-- CreateIndex
CREATE INDEX "scraper_tiktok_profiles_sec_uid_idx" ON "scraper_tiktok_profiles"("sec_uid");

-- CreateIndex
CREATE INDEX "scraper_tiktok_profiles_is_owned_idx" ON "scraper_tiktok_profiles"("is_owned");

-- CreateIndex
CREATE INDEX "users_manager_id_idx" ON "users"("manager_id");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE INDEX "users_team_idx" ON "users"("team");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_channels" ADD CONSTRAINT "tracked_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_duplicates" ADD CONSTRAINT "video_duplicates_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_histories" ADD CONSTRAINT "search_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "huyk_channels" ADD CONSTRAINT "huyk_channels_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "huyk_channels" ADD CONSTRAINT "huyk_channels_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_xiaohongshu_videos" ADD CONSTRAINT "scraper_xiaohongshu_videos_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_xiaohongshu_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_products" ADD CONSTRAINT "team_products_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_products" ADD CONSTRAINT "team_products_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_products" ADD CONSTRAINT "team_products_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_products" ADD CONSTRAINT "team_products_product_line_id_fkey" FOREIGN KEY ("product_line_id") REFERENCES "product_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_products" ADD CONSTRAINT "team_products_source_editor_product_id_fkey" FOREIGN KEY ("source_editor_product_id") REFERENCES "editor_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_products" ADD CONSTRAINT "team_products_source_product_id_fkey" FOREIGN KEY ("source_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_contents" ADD CONSTRAINT "team_contents_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_contents" ADD CONSTRAINT "team_contents_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_contents" ADD CONSTRAINT "team_contents_content_line_id_fkey" FOREIGN KEY ("content_line_id") REFERENCES "content_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_contents" ADD CONSTRAINT "team_contents_source_editor_content_id_fkey" FOREIGN KEY ("source_editor_content_id") REFERENCES "editor_contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_contents" ADD CONSTRAINT "team_contents_source_content_id_fkey" FOREIGN KEY ("source_content_id") REFERENCES "contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_sources" ADD CONSTRAINT "team_sources_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_sources" ADD CONSTRAINT "team_sources_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_sources" ADD CONSTRAINT "team_sources_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_sources" ADD CONSTRAINT "team_sources_team_product_id_fkey" FOREIGN KEY ("team_product_id") REFERENCES "team_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_sources" ADD CONSTRAINT "team_sources_source_editor_source_id_fkey" FOREIGN KEY ("source_editor_source_id") REFERENCES "editor_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_sources" ADD CONSTRAINT "team_sources_source_source_id_fkey" FOREIGN KEY ("source_source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_products" ADD CONSTRAINT "editor_products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_products" ADD CONSTRAINT "editor_products_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_products" ADD CONSTRAINT "editor_products_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_products" ADD CONSTRAINT "editor_products_product_line_id_fkey" FOREIGN KEY ("product_line_id") REFERENCES "product_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_products" ADD CONSTRAINT "editor_products_source_product_id_fkey" FOREIGN KEY ("source_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_contents" ADD CONSTRAINT "editor_contents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_contents" ADD CONSTRAINT "editor_contents_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_contents" ADD CONSTRAINT "editor_contents_content_line_id_fkey" FOREIGN KEY ("content_line_id") REFERENCES "content_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_contents" ADD CONSTRAINT "editor_contents_source_content_id_fkey" FOREIGN KEY ("source_content_id") REFERENCES "contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_sources" ADD CONSTRAINT "editor_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_sources" ADD CONSTRAINT "editor_sources_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_sources" ADD CONSTRAINT "editor_sources_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_sources" ADD CONSTRAINT "editor_sources_editor_product_id_fkey" FOREIGN KEY ("editor_product_id") REFERENCES "editor_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_sources" ADD CONSTRAINT "editor_sources_source_source_id_fkey" FOREIGN KEY ("source_source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_push_requests" ADD CONSTRAINT "team_push_requests_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_push_requests" ADD CONSTRAINT "team_push_requests_editor_product_id_fkey" FOREIGN KEY ("editor_product_id") REFERENCES "editor_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_push_requests" ADD CONSTRAINT "team_push_requests_editor_content_id_fkey" FOREIGN KEY ("editor_content_id") REFERENCES "editor_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_push_requests" ADD CONSTRAINT "team_push_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_push_requests" ADD CONSTRAINT "team_push_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_approvals" ADD CONSTRAINT "editor_approvals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_approvals" ADD CONSTRAINT "editor_approvals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_kpis" ADD CONSTRAINT "team_kpis_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_kpis" ADD CONSTRAINT "team_kpis_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_kpi_allocations" ADD CONSTRAINT "team_kpi_allocations_team_kpi_id_fkey" FOREIGN KEY ("team_kpi_id") REFERENCES "team_kpis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_kpi_allocations" ADD CONSTRAINT "team_kpi_allocations_content_line_id_fkey" FOREIGN KEY ("content_line_id") REFERENCES "content_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_kpi_allocations" ADD CONSTRAINT "team_kpi_allocations_product_line_id_fkey" FOREIGN KEY ("product_line_id") REFERENCES "product_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_kpis" ADD CONSTRAINT "editor_kpis_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_kpis" ADD CONSTRAINT "editor_kpis_set_by_id_fkey" FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_kpis" ADD CONSTRAINT "editor_kpis_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_kpi_allocations" ADD CONSTRAINT "editor_kpi_allocations_editor_kpi_id_fkey" FOREIGN KEY ("editor_kpi_id") REFERENCES "editor_kpis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_kpi_allocations" ADD CONSTRAINT "editor_kpi_allocations_content_line_id_fkey" FOREIGN KEY ("content_line_id") REFERENCES "content_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_kpi_allocations" ADD CONSTRAINT "editor_kpi_allocations_product_line_id_fkey" FOREIGN KEY ("product_line_id") REFERENCES "product_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_product_line_id_fkey" FOREIGN KEY ("product_line_id") REFERENCES "product_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_source_team_product_id_fkey" FOREIGN KEY ("source_team_product_id") REFERENCES "team_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_content_line_id_fkey" FOREIGN KEY ("content_line_id") REFERENCES "content_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_source_team_content_id_fkey" FOREIGN KEY ("source_team_content_id") REFERENCES "team_contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_source_team_source_id_fkey" FOREIGN KEY ("source_team_source_id") REFERENCES "team_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_ordered_team_id_fkey" FOREIGN KEY ("ordered_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_editor_product_id_fkey" FOREIGN KEY ("editor_product_id") REFERENCES "editor_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_product_id_fkey" FOREIGN KEY ("team_product_id") REFERENCES "team_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_editor_content_id_fkey" FOREIGN KEY ("editor_content_id") REFERENCES "editor_contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_content_id_fkey" FOREIGN KEY ("team_content_id") REFERENCES "team_contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_content_line_id_fkey" FOREIGN KEY ("content_line_id") REFERENCES "content_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_product_line_id_fkey" FOREIGN KEY ("product_line_id") REFERENCES "product_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_outro_id_fkey" FOREIGN KEY ("source_outro_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_extra_id_fkey" FOREIGN KEY ("source_extra_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_workshop_id_fkey" FOREIGN KEY ("source_workshop_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_huyk_id_fkey" FOREIGN KEY ("source_huyk_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_editor_source_outro_id_fkey" FOREIGN KEY ("editor_source_outro_id") REFERENCES "editor_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_editor_source_extra_id_fkey" FOREIGN KEY ("editor_source_extra_id") REFERENCES "editor_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_editor_source_workshop_id_fkey" FOREIGN KEY ("editor_source_workshop_id") REFERENCES "editor_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_editor_source_huyk_id_fkey" FOREIGN KEY ("editor_source_huyk_id") REFERENCES "editor_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_source_outro_id_fkey" FOREIGN KEY ("team_source_outro_id") REFERENCES "team_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_source_extra_id_fkey" FOREIGN KEY ("team_source_extra_id") REFERENCES "team_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_source_workshop_id_fkey" FOREIGN KEY ("team_source_workshop_id") REFERENCES "team_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_source_huyk_id_fkey" FOREIGN KEY ("team_source_huyk_id") REFERENCES "team_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "assignment_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_pending_videos" ADD CONSTRAINT "task_pending_videos_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "assignment_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_warehouses" ADD CONSTRAINT "product_warehouses_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_warehouses" ADD CONSTRAINT "content_warehouses_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_warehouses" ADD CONSTRAINT "source_warehouses_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_product_warehouses" ADD CONSTRAINT "team_product_warehouses_team_product_id_fkey" FOREIGN KEY ("team_product_id") REFERENCES "team_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_content_warehouses" ADD CONSTRAINT "team_content_warehouses_team_content_id_fkey" FOREIGN KEY ("team_content_id") REFERENCES "team_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_source_warehouses" ADD CONSTRAINT "team_source_warehouses_team_source_id_fkey" FOREIGN KEY ("team_source_id") REFERENCES "team_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_product_warehouses" ADD CONSTRAINT "editor_product_warehouses_editor_product_id_fkey" FOREIGN KEY ("editor_product_id") REFERENCES "editor_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_content_warehouses" ADD CONSTRAINT "editor_content_warehouses_editor_content_id_fkey" FOREIGN KEY ("editor_content_id") REFERENCES "editor_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_source_warehouses" ADD CONSTRAINT "editor_source_warehouses_editor_source_id_fkey" FOREIGN KEY ("editor_source_id") REFERENCES "editor_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
