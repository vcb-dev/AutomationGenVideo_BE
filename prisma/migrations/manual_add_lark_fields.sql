-- Add Lark-specific fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS ma_pin TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS team TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lark_permissions JSONB;
