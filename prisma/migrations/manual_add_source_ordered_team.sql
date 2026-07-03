-- Add ordered_team_id to sources: team that ordered this source at creation time
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "ordered_team_id" TEXT;
ALTER TABLE "sources"
  ADD CONSTRAINT "sources_ordered_team_id_fkey"
  FOREIGN KEY ("ordered_team_id") REFERENCES "teams"("id") ON DELETE SET NULL;
