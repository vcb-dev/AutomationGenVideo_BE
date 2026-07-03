-- Add TeamMarket enum and market column to teams
-- Existing teams default to VIETNAM
-- Delete content with GLOBAL market (no data existed at migration time)

-- Enum created by prisma db push (2026-06-27)
-- ALTER TYPE "TeamMarket" ...  handled automatically

-- teams.market column (added by prisma db push):
--   ALTER TABLE teams ADD COLUMN market "TeamMarket" NOT NULL DEFAULT 'VIETNAM';
--   CREATE INDEX teams_market_idx ON teams(market);

-- ContentMarket enum updated (GLOBAL removed, INDONESIA/JAPAN/THAILAND added):
--   No GLOBAL rows existed in contents table at migration time.

-- Cleanup (run if any GLOBAL rows remain):
-- DELETE FROM contents WHERE market = 'GLOBAL';
-- DELETE FROM "EditorContent" WHERE market = 'GLOBAL';
-- DELETE FROM "TeamContent"   WHERE market = 'GLOBAL';
