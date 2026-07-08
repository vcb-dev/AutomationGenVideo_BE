-- Add owner_id / team_id to huyk_channels (nullable, for channels-team module)
-- These columns are declared in schema.prisma (Channel.owner_id / Channel.team_id)
-- but were missing from any prior migration, causing 500 errors in production
-- whenever ChannelsService queries include channel_owner / channel_team.
ALTER TABLE "huyk_channels" ADD COLUMN IF NOT EXISTS "owner_id" UUID;
ALTER TABLE "huyk_channels" ADD COLUMN IF NOT EXISTS "team_id" UUID;

-- Force cast to UUID in case they were already created as TEXT by the failed migration attempt
ALTER TABLE "huyk_channels" ALTER COLUMN "owner_id" TYPE UUID USING "owner_id"::UUID;
ALTER TABLE "huyk_channels" ALTER COLUMN "team_id" TYPE UUID USING "team_id"::UUID;

-- FK to users (ChannelOwnerUser relation) — guarded so this is a no-op on
-- environments (e.g. local dev) where the column/constraint was already
-- added out-of-band via `prisma db push` instead of a tracked migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'huyk_channels_owner_id_fkey'
  ) THEN
    ALTER TABLE "huyk_channels"
      ADD CONSTRAINT "huyk_channels_owner_id_fkey"
      FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- FK to teams (ChannelTeam relation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'huyk_channels_team_id_fkey'
  ) THEN
    ALTER TABLE "huyk_channels"
      ADD CONSTRAINT "huyk_channels_team_id_fkey"
      FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "huyk_channels_owner_id_idx" ON "huyk_channels"("owner_id");
CREATE INDEX IF NOT EXISTS "huyk_channels_team_id_idx" ON "huyk_channels"("team_id");
