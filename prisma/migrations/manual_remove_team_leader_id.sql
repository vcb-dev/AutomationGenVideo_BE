-- Migration: remove_team_leader_id
-- Xóa bỏ cột team_leader_id, index và foreign key liên quan khỏi bảng users

-- 1. Xóa foreign key constraint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_team_leader_id_fkey";

-- 2. Xóa index
DROP INDEX IF EXISTS "users_team_leader_id_idx";

-- 3. Xóa cột
ALTER TABLE "users" DROP COLUMN IF EXISTS "team_leader_id";
