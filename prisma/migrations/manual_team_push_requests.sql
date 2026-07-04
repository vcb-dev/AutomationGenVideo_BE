-- TeamPushRequest: hàng đợi duyệt đẩy product/content từ kho cá nhân → kho team.
-- Leader/Admin/Manager đẩy thì bỏ qua hàng đợi. Partial unique index chặn trùng
-- request PENDING cho cùng item + team (bị từ chối vẫn gửi lại được).
-- Applied via `prisma db execute` (không dùng `prisma migrate dev` — xem các file manual_*.sql khác).

CREATE TYPE "TeamPushRequestType" AS ENUM ('PRODUCT', 'CONTENT');

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

CREATE INDEX "team_push_requests_team_id_status_idx" ON "team_push_requests"("team_id", "status");
CREATE INDEX "team_push_requests_requested_by_id_idx" ON "team_push_requests"("requested_by_id");
CREATE UNIQUE INDEX "team_push_requests_pending_product_uq"
    ON "team_push_requests"("team_id", "editor_product_id")
    WHERE "status" = 'PENDING' AND "editor_product_id" IS NOT NULL;
CREATE UNIQUE INDEX "team_push_requests_pending_content_uq"
    ON "team_push_requests"("team_id", "editor_content_id")
    WHERE "status" = 'PENDING' AND "editor_content_id" IS NOT NULL;

ALTER TABLE "team_push_requests" ADD CONSTRAINT "team_push_requests_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_push_requests" ADD CONSTRAINT "team_push_requests_editor_product_id_fkey" FOREIGN KEY ("editor_product_id") REFERENCES "editor_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_push_requests" ADD CONSTRAINT "team_push_requests_editor_content_id_fkey" FOREIGN KEY ("editor_content_id") REFERENCES "editor_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_push_requests" ADD CONSTRAINT "team_push_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_push_requests" ADD CONSTRAINT "team_push_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
