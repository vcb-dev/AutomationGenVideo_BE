/*
  Warnings:

  - You are about to drop the column `file_size` on the `videos` table. All the data in the column will be lost.
  - You are about to drop the column `metadata_hash` on the `videos` table. All the data in the column will be lost.
  - You are about to drop the column `total_posts` on the `videos` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('UNIQUE', 'DUPLICATE', 'PENDING_REVIEW', 'SUSPICIOUS');

-- DropIndex
DROP INDEX "videos_content_hash_key";

-- DropIndex
DROP INDEX "videos_created_at_idx";

-- AlterTable
ALTER TABLE "tracked_channels" ADD COLUMN     "initial_video_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "videos" DROP COLUMN "file_size",
DROP COLUMN "metadata_hash",
DROP COLUMN "total_posts",
ADD COLUMN     "file_url" TEXT,
ALTER COLUMN "content_hash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "video_fingerprints" (
    "id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "feature_vector" DOUBLE PRECISION[],
    "perceptual_hash" TEXT,
    "keyframe_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duration_seconds" INTEGER NOT NULL,
    "frame_count" INTEGER,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_groups" (
    "id" TEXT NOT NULL,
    "master_video_id" TEXT NOT NULL,
    "production_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_duplicates" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "status" "DuplicateStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "is_master" BOOLEAN NOT NULL DEFAULT false,
    "similarity_score" DOUBLE PRECISION,
    "detection_method" TEXT,
    "confidence_level" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_duplicates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_reviews" (
    "id" TEXT NOT NULL,
    "new_video_id" TEXT NOT NULL,
    "suspected_duplicate_of" TEXT NOT NULL,
    "similarity_score" DOUBLE PRECISION NOT NULL,
    "detection_method" TEXT NOT NULL,
    "confidence_level" TEXT NOT NULL,
    "status" "DuplicateStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "decision" TEXT,
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "duplicate_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "video_fingerprints_video_id_key" ON "video_fingerprints"("video_id");

-- CreateIndex
CREATE INDEX "video_fingerprints_video_id_idx" ON "video_fingerprints"("video_id");

-- CreateIndex
CREATE INDEX "video_groups_master_video_id_idx" ON "video_groups"("master_video_id");

-- CreateIndex
CREATE INDEX "video_duplicates_group_id_idx" ON "video_duplicates"("group_id");

-- CreateIndex
CREATE INDEX "video_duplicates_video_id_idx" ON "video_duplicates"("video_id");

-- CreateIndex
CREATE INDEX "video_duplicates_status_idx" ON "video_duplicates"("status");

-- CreateIndex
CREATE INDEX "video_duplicates_reviewed_by_idx" ON "video_duplicates"("reviewed_by");

-- CreateIndex
CREATE UNIQUE INDEX "video_duplicates_video_id_key" ON "video_duplicates"("video_id");

-- CreateIndex
CREATE INDEX "duplicate_reviews_new_video_id_idx" ON "duplicate_reviews"("new_video_id");

-- CreateIndex
CREATE INDEX "duplicate_reviews_suspected_duplicate_of_idx" ON "duplicate_reviews"("suspected_duplicate_of");

-- CreateIndex
CREATE INDEX "duplicate_reviews_status_idx" ON "duplicate_reviews"("status");

-- CreateIndex
CREATE INDEX "duplicate_reviews_reviewed_by_idx" ON "duplicate_reviews"("reviewed_by");

-- CreateIndex
CREATE INDEX "duplicate_reviews_created_at_idx" ON "duplicate_reviews"("created_at");

-- AddForeignKey
ALTER TABLE "video_fingerprints" ADD CONSTRAINT "video_fingerprints_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_duplicates" ADD CONSTRAINT "video_duplicates_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "video_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_duplicates" ADD CONSTRAINT "video_duplicates_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_duplicates" ADD CONSTRAINT "video_duplicates_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_reviews" ADD CONSTRAINT "duplicate_reviews_new_video_id_fkey" FOREIGN KEY ("new_video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_reviews" ADD CONSTRAINT "duplicate_reviews_suspected_duplicate_of_fkey" FOREIGN KEY ("suspected_duplicate_of") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_reviews" ADD CONSTRAINT "duplicate_reviews_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
