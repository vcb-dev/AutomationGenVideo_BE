-- Shadow DB của repo đang hỏng lịch sử (xem MIGRATION_DEBT.md), không dùng được `prisma
-- migrate dev` bình thường. Lấy nguyên văn output của:
--   npx prisma migrate diff --from-schema-datamodel <schema.prisma @ commit trước> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- (cùng cách đã dùng ở content-transform, xem commit "dùng nguyên văn SQL từ prisma migrate
-- diff + ghi lại cách kiểm chứng"). Đã áp thử trên PostgreSQL 15 thật (docker
-- postgres:15-alpine) lên bảng thử với 2 dòng dữ liệu cũ trước khi áp lên Supabase: ALTER chạy
-- sạch (exit 0), 2 dòng cũ nguyên vẹn, cột mới tự động = 'office'. Chạy lại lần 2 báo lỗi cột
-- đã tồn tại (không có tác dụng phụ, không sửa/xoá dữ liệu) — đúng hành vi ADD COLUMN.

-- AlterTable
ALTER TABLE "id_photo_histories" ADD COLUMN     "outfit_type" TEXT NOT NULL DEFAULT 'office';
