ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
ALTER TABLE users DROP COLUMN IF EXISTS last_activity_at;
ALTER TABLE users DROP COLUMN IF EXISTS total_login_count;
ALTER TABLE users DROP COLUMN IF EXISTS total_action_count;
