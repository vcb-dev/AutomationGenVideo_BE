-- CreateEnum
CREATE TYPE "IdPhotoBatchStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "id_photo_histories" ADD COLUMN     "batch_job_id" UUID;

-- CreateTable
CREATE TABLE "id_photo_batch_jobs" (
    "id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "total_count" INTEGER NOT NULL,
    "status" "IdPhotoBatchStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "id_photo_batch_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "id_photo_batch_jobs_created_by_idx" ON "id_photo_batch_jobs"("created_by");

-- CreateIndex
CREATE INDEX "id_photo_batch_jobs_status_updated_at_idx" ON "id_photo_batch_jobs"("status", "updated_at");

-- CreateIndex
CREATE INDEX "id_photo_histories_batch_job_id_idx" ON "id_photo_histories"("batch_job_id");

-- CreateIndex
CREATE INDEX "id_photo_histories_batch_job_id_status_idx" ON "id_photo_histories"("batch_job_id", "status");

-- AddForeignKey
ALTER TABLE "id_photo_histories" ADD CONSTRAINT "id_photo_histories_batch_job_id_fkey" FOREIGN KEY ("batch_job_id") REFERENCES "id_photo_batch_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "id_photo_batch_jobs" ADD CONSTRAINT "id_photo_batch_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

