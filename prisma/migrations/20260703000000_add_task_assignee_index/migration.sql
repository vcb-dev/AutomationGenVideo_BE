-- Bảng tasks chưa có index nào trên assignee_id, dù đây là điều kiện lọc
-- chính trong toàn bộ auto-assign (editor-eligibility.ts, editor-history.ts).
-- Thiếu index khiến mỗi lượt chạy assign (mỗi phút qua cron) phải full scan
-- toàn bộ bảng tasks.

CREATE INDEX IF NOT EXISTS "tasks_assignee_id_team_id_assigned_at_idx" ON "tasks"("assignee_id", "team_id", "assigned_at");
