-- TaskContentApproval: hàng đợi duyệt content mới do editor viết trong task detail
-- Trước đây chỉ có manual_task_content_approvals.sql (CI không chạy file manual_*).

CREATE TABLE IF NOT EXISTS "task_content_approvals" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "content" TEXT NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_content_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "task_content_approvals_task_id_created_at_idx"
  ON "task_content_approvals"("task_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "task_content_approvals_requested_by_id_idx"
  ON "task_content_approvals"("requested_by_id");

CREATE UNIQUE INDEX IF NOT EXISTS "task_content_approvals_pending_uq"
  ON "task_content_approvals"("task_id")
  WHERE "status" = 'PENDING';

DO $$ BEGIN
  ALTER TABLE "task_content_approvals"
    ADD CONSTRAINT "task_content_approvals_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "task_content_approvals"
    ADD CONSTRAINT "task_content_approvals_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "task_content_approvals"
    ADD CONSTRAINT "task_content_approvals_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
