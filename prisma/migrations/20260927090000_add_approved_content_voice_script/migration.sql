-- Bộ Sưu Tập: kịch bản sinh từ lời thoại + hình ảnh của video (Gemini), chạy nền sau khi duyệt.
-- Dòng cũ đã có kịch bản nên script_status mặc định DONE.

-- AlterTable
ALTER TABLE "approved_content" ADD COLUMN "script_status" VARCHAR(20) NOT NULL DEFAULT 'DONE',
ADD COLUMN "script_source" VARCHAR(30),
ADD COLUMN "transcript" TEXT,
ADD COLUMN "transcript_language" VARCHAR(20),
ADD COLUMN "has_voice" BOOLEAN,
ADD COLUMN "script_error" TEXT,
ADD COLUMN "source_platform" VARCHAR(20),
ADD COLUMN "download_source" VARCHAR(20);
