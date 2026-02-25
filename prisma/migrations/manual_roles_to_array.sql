-- Change role column from single enum to array of enums
-- Step 1: Add new roles column as array
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roles" "UserRole"[] DEFAULT '{}';

-- Step 2: Copy existing role data to roles array
UPDATE "users" SET "roles" = ARRAY["role"] WHERE "role" IS NOT NULL AND "roles" = '{}';

-- Step 3: Drop the old role column
ALTER TABLE "users" DROP COLUMN IF EXISTS "role";

-- Step 4: Create index on roles
CREATE INDEX IF NOT EXISTS "users_roles_idx" ON "users" USING GIN ("roles");
