-- Ghi lại ai đã set assignee_id cho task khi giao tay (privileged user giao cho người khác),
-- để phân biệt với member tự nhận task (self-claim, không set cột này). Dùng để chặn member tự
-- xoá task được leader giao / hệ thống tự động chia — xem tasks.service.ts remove().
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "assigned_by_id" UUID;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_by_id_fkey"
    FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
