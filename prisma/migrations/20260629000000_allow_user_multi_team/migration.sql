-- Allow a user to belong to multiple teams
-- 1. Drop the old unique constraint on user_id
ALTER TABLE "team_members" DROP CONSTRAINT IF EXISTS "team_members_user_id_key";

-- 2. Add composite unique constraint (team_id, user_id) to prevent duplicate membership in same team
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_user_id_key" UNIQUE ("team_id", "user_id");

-- 3. Add index on user_id for lookup performance
CREATE INDEX IF NOT EXISTS "team_members_user_id_idx" ON "team_members"("user_id");
