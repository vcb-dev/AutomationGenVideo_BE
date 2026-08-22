-- Tạo bảng cho tính năng "Tạo ảnh thẻ nhân viên" (module src/modules/id-photo).
-- FE upload ảnh gốc → BE orchestrate gọi AI service (Gemini) ghép áo polo đen → nhập thông
-- tin nhân viên → xuất PDF theo khung màu ánh xạ từ `position`. BE không lưu tên màu khung
-- trực tiếp, chỉ lưu ý nghĩa cấp bậc — tầng hiển thị tự ánh xạ sang màu (xem IdPhotoPosition
-- trong schema.prisma và id-photo.service.ts).

-- CreateEnum
CREATE TYPE "IdPhotoPosition" AS ENUM ('NEW_STAFF_1_3M', 'STAFF_OVER_3M', 'LEADER', 'MANAGER', 'BOD');

-- CreateEnum
CREATE TYPE "IdPhotoStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "id_photo_histories" (
    "id" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "employee_name" TEXT NOT NULL,
    "employee_team" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "position" "IdPhotoPosition" NOT NULL,
    "raw_image_data" TEXT NOT NULL,
    "processed_image_data" TEXT,
    "status" "IdPhotoStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "pdf_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "id_photo_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "id_photo_histories_created_by_idx" ON "id_photo_histories"("created_by");

-- CreateIndex
CREATE INDEX "id_photo_histories_status_idx" ON "id_photo_histories"("status");

-- CreateIndex
CREATE INDEX "id_photo_histories_created_at_idx" ON "id_photo_histories"("created_at");

-- AddForeignKey
ALTER TABLE "id_photo_histories" ADD CONSTRAINT "id_photo_histories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
