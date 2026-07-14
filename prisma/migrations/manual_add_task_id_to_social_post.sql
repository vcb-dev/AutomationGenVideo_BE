-- Task: liên kết SocialPost với Task để nhúng "lên lịch đăng bài" vào chi tiết task
-- (sau khi task được duyệt). Cột nullable, không cần backfill — dữ liệu cũ giữ task_id = NULL.
-- Applied via `prisma db execute` (không dùng `prisma migrate dev` — shadow DB lỗi trên
-- migration cũ `20260626000000_add_warehouse_month`, xem các file manual_*.sql khác).

ALTER TABLE "social_posts" ADD COLUMN "task_id" TEXT;

CREATE INDEX "social_posts_task_id_idx" ON "social_posts"("task_id");
