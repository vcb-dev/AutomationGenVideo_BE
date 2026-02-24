-- Add TEAM_LEADER to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'TEAM_LEADER' AFTER 'MANAGER';

-- Add team_leader_id column to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "team_leader_id" TEXT;

-- Add is_video_leader column to users table  
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_video_leader" BOOLEAN NOT NULL DEFAULT false;

-- Add index on team_leader_id
CREATE INDEX IF NOT EXISTS "users_team_leader_id_idx" ON "users"("team_leader_id");

-- Add foreign key constraint for team_leader_id
ALTER TABLE "users" ADD CONSTRAINT "users_team_leader_id_fkey" 
  FOREIGN KEY ("team_leader_id") REFERENCES "users"("id") 
  ON DELETE SET NULL ON UPDATE CASCADE;
