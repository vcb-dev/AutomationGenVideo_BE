-- Task: đổi ngữ nghĩa task_type — AUTO chỉ dành cho task đẩy SP theo kế hoạch (lane 1);
-- lane sáng tạo của auto-assign (lane 2) chuyển về EXTRA, cùng cờ với task tạo tay.
-- Backfill: is_product_push đã chuẩn cho dữ liệu cũ (xem manual_task_is_product_push.sql)
-- nên task AUTO không đẩy SP chính là task sáng tạo do hệ thống chia.
-- Applied via `prisma db execute` (không dùng `prisma migrate dev` — xem các file manual_*.sql khác).

UPDATE "tasks" SET "task_type" = 'EXTRA'
WHERE "task_type" = 'AUTO' AND "is_product_push" = false;
