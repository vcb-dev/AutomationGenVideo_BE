-- Task: thêm cờ is_product_push đánh dấu task đẩy SP theo kế hoạch (sản phẩm từ kho team).
-- Backfill: task AUTO cũ dùng team_product_id chính là task đẩy SP theo định nghĩa hiện hành.
-- Applied via `prisma db execute` (không dùng `prisma migrate dev` — xem các file manual_*.sql khác).

ALTER TABLE "tasks" ADD COLUMN "is_product_push" BOOLEAN NOT NULL DEFAULT false;

UPDATE "tasks" SET "is_product_push" = true
WHERE "team_product_id" IS NOT NULL AND "task_type" = 'AUTO';
