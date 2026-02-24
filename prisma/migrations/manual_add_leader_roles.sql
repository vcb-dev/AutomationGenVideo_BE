-- Add LEADER_VIDEO and LEADER_CONTENT to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'LEADER_VIDEO' AFTER 'MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'LEADER_CONTENT' AFTER 'LEADER_VIDEO';

-- Remove is_video_leader column (no longer needed, role itself determines the type)
ALTER TABLE "users" DROP COLUMN IF EXISTS "is_video_leader";
