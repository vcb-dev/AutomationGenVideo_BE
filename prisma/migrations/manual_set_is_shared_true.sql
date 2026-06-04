-- Set is_shared = true for all existing active accounts
-- Run: psql $DATABASE_URL < prisma/migrations/manual_set_is_shared_true.sql

UPDATE social_accounts SET is_shared = true WHERE is_active = true;
