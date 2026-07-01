-- Add team_id to editor_kpis (nullable for backward compat with existing rows)
ALTER TABLE "editor_kpis" ADD COLUMN IF NOT EXISTS "team_id" TEXT;

-- Drop old unique constraint (user_id, month)
ALTER TABLE "editor_kpis" DROP CONSTRAINT IF EXISTS "editor_kpis_user_id_month_key";

-- Add new unique constraint (user_id, team_id, month)
-- NULL-safe: two rows with team_id=NULL and same (user_id, month) are allowed by PG,
-- but service always sets team_id so this won't happen in practice.
ALTER TABLE "editor_kpis" ADD CONSTRAINT "editor_kpis_user_id_team_id_month_key"
  UNIQUE ("user_id", "team_id", "month");

-- Add FK to teams
ALTER TABLE "editor_kpis"
  ADD CONSTRAINT "editor_kpis_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index
CREATE INDEX IF NOT EXISTS "editor_kpis_team_id_idx" ON "editor_kpis"("team_id");
