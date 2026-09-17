-- Add permissions array column to users table for granular RBAC
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
