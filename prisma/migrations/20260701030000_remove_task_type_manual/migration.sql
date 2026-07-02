-- MANUAL was retired from TaskType (see schema.prisma: task creation no longer sets it,
-- everything user-created now defaults to EXTRA). Existing rows never got backfilled,
-- which crashes every Task query the moment Prisma tries to deserialize a 'MANUAL' row
-- against the regenerated client (MANUAL is no longer a member of the enum type).

-- 1. Backfill stale rows before narrowing the enum, or the cast below fails.
UPDATE "tasks" SET "task_type" = 'EXTRA' WHERE "task_type" = 'MANUAL';

-- 2. Postgres has no ALTER TYPE ... DROP VALUE, so recreate the enum without MANUAL.
CREATE TYPE "TaskType_new" AS ENUM ('AUTO', 'EXTRA');
ALTER TABLE "tasks" ALTER COLUMN "task_type" DROP DEFAULT;
ALTER TABLE "tasks" ALTER COLUMN "task_type" TYPE "TaskType_new" USING ("task_type"::text::"TaskType_new");
ALTER TYPE "TaskType" RENAME TO "TaskType_old";
ALTER TYPE "TaskType_new" RENAME TO "TaskType";
DROP TYPE "TaskType_old";
ALTER TABLE "tasks" ALTER COLUMN "task_type" SET DEFAULT 'EXTRA';
