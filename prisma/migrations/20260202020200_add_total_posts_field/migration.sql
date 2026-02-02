-- AlterTable
ALTER TABLE "tracked_channels" ADD COLUMN IF NOT EXISTS "total_posts" INTEGER NOT NULL DEFAULT 0;
