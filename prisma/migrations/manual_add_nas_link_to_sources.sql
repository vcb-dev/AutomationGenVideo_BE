-- Add nas_link field to sources, team_sources, editor_sources tables
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "nas_link" VARCHAR(2000);
ALTER TABLE "team_sources" ADD COLUMN IF NOT EXISTS "nas_link" VARCHAR(2000);
ALTER TABLE "editor_sources" ADD COLUMN IF NOT EXISTS "nas_link" VARCHAR(2000);
