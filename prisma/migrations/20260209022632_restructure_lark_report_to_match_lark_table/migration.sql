/*
  Warnings:

  - You are about to drop the column `avatar` on the `lark_reports` table. All the data in the column will be lost.
  - You are about to drop the column `checklist` on the `lark_reports` table. All the data in the column will be lost.
  - You are about to drop the column `questions` on the `lark_reports` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `lark_reports` table. All the data in the column will be lost.
  - You are about to drop the column `submitted_at` on the `lark_reports` table. All the data in the column will be lost.
  - You are about to drop the column `video_source_count` on the `lark_reports` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "lark_reports" DROP COLUMN "avatar",
DROP COLUMN "checklist",
DROP COLUMN "questions",
DROP COLUMN "status",
DROP COLUMN "submitted_at",
DROP COLUMN "video_source_count",
ADD COLUMN     "answers" JSONB,
ADD COLUMN     "date" TIMESTAMP(3),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "employee" JSONB,
ADD COLUMN     "role" TEXT;
