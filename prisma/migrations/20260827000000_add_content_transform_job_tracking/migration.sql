-- Theo dõi job nền (transcribe/upgrade chạy lâu) cho content_transform_histories.
--
-- Vì sao: transcribe file dài / upgrade kịch bản dài chạy hàng trăm giây trong MỘT request
-- đồng bộ và hay chạm ngân sách ~415s -> Django tự trả 504. Chuyển sang mô hình job nền +
-- poll (giống voice-clone). BE cần lưu job_id của AI service để poll lại được sau khi FE
-- mất kết nối, và để reconciliation cron dọn các bản ghi PENDING "mất dấu" khi AI/BE restart.
--
-- ai_job_id / ai_job_kind: NULLABLE, không default. NULL = không có job nền (bản ghi của luồng
-- đồng bộ transform/rescore, hoặc job đã xong và kết quả đã ghi vào bản ghi).
--
-- Index (status, updated_at): cho cron quét nhanh bản ghi status=PENDING + updated_at quá hạn.
--
-- SQL bên dưới lấy nguyên văn từ `prisma migrate diff --from-schema-datamodel <base> \
--   --to-schema-datamodel prisma/schema.prisma --script` (engine giống hệt `migrate dev`,
-- chỉ khác là không cần shadow DB — shadow DB của repo đang hỏng, xem MIGRATION_DEBT.md).
-- Đã áp thử trên PostgreSQL 15 thật: ALTER + CREATE INDEX chạy sạch, dữ liệu cũ nguyên vẹn,
-- cột mới = NULL; chạy lại lần 2 fail trong transaction (rollback, không hỏng dữ liệu).

-- AlterTable
ALTER TABLE "content_transform_histories" ADD COLUMN     "ai_job_id" TEXT,
ADD COLUMN     "ai_job_kind" TEXT;

-- CreateIndex
CREATE INDEX "content_transform_histories_status_updated_at_idx" ON "content_transform_histories"("status", "updated_at");
