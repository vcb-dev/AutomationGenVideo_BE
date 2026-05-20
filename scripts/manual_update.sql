ALTER TABLE "social_posts" ADD COLUMN IF NOT EXISTS "thumb_url" TEXT;
ALTER TABLE "social_drafts" ADD COLUMN IF NOT EXISTS "thumb_url" TEXT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_user_id_fkey') THEN
        ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
    END IF;
END $$;

-- Alter users table to add all missing columns from prisma/schema.prisma
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "manager_id" uuid;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "team_leader_id" uuid;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_id" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "team" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lark_employee_record_id" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_id" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "image_url" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_data" jsonb;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_position" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_status" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_date" timestamp(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP;

-- Unique constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_google_id_key') THEN
        ALTER TABLE "users" ADD CONSTRAINT "users_google_id_key" UNIQUE ("google_id");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_lark_employee_record_id_key') THEN
        ALTER TABLE "users" ADD CONSTRAINT "users_lark_employee_record_id_key" UNIQUE ("lark_employee_record_id");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_employee_id_key') THEN
        ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_key" UNIQUE ("employee_id");
    END IF;
END $$;

-- Foreign key constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_manager_id_fkey') THEN
        ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_team_leader_id_fkey') THEN
        ALTER TABLE "users" ADD CONSTRAINT "users_team_leader_id_fkey" FOREIGN KEY ("team_leader_id") REFERENCES "users"("id") ON DELETE SET NULL;
    END IF;
END $$;
