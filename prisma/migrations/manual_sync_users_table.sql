-- Migration: sync_users_table
-- Đồng bộ bảng users trên server theo đúng prisma/schema.prisma hiện tại (model User)
-- Idempotent: chạy lại nhiều lần không lỗi (IF NOT EXISTS / DO block)
-- Cách chạy: psql "$DATABASE_URL" -f prisma/migrations/manual_sync_users_table.sql

-- 1. Enum UserRole (tạo nếu chưa có, bổ sung value nếu thiếu)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN
        CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'MEMBER', 'LEADER');
    END IF;
END $$;

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MEMBER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'LEADER';

-- 2. Tạo bảng users nếu chưa tồn tại (server mới hoàn toàn)
CREATE TABLE IF NOT EXISTS "users" (
    "id"                      UUID NOT NULL DEFAULT gen_random_uuid(),
    "email"                   TEXT NOT NULL,
    "password_hash"           TEXT,
    "full_name"               TEXT NOT NULL,
    "google_id"               TEXT,
    "manager_id"              UUID,
    "is_active"               BOOLEAN NOT NULL DEFAULT true,
    "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roles"                   "UserRole"[] DEFAULT ARRAY[]::"UserRole"[],
    "team"                    TEXT,
    "lark_employee_record_id" TEXT,
    "employee_id"             TEXT,
    "image_url"               TEXT,
    "employee_data"           JSONB,
    "employee_position"       TEXT,
    "employee_status"         TEXT,
    "employee_date"           TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- 3. Bổ sung các cột còn thiếu (server đã có bảng users từ bản cũ)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash"           TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_id"               TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "manager_id"              TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_active"               BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roles"                   "UserRole"[] DEFAULT ARRAY[]::"UserRole"[];
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "team"                    TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lark_employee_record_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_id"             TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "image_url"               TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_data"           JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_position"       TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_status"         TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_date"           TIMESTAMP(3);

-- 4. Dọn các cột đã bị loại khỏi schema (đã có migration riêng, nhắc lại cho server mới sync)
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_team_leader_id_fkey";
DROP INDEX IF EXISTS "users_team_leader_id_idx";
ALTER TABLE "users" DROP COLUMN IF EXISTS "team_leader_id";
ALTER TABLE "users" DROP COLUMN IF EXISTS "custom_permissions";

-- 5. Unique index (Prisma @unique)
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key"                   ON "users"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "users_google_id_key"               ON "users"("google_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_lark_employee_record_id_key" ON "users"("lark_employee_record_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_employee_id_key"             ON "users"("employee_id");

-- 6. Index thường (Prisma @@index)
CREATE INDEX IF NOT EXISTS "users_email_idx"      ON "users"("email");
CREATE INDEX IF NOT EXISTS "users_roles_idx"      ON "users"("roles");
CREATE INDEX IF NOT EXISTS "users_manager_id_idx" ON "users"("manager_id");
CREATE INDEX IF NOT EXISTS "users_is_active_idx"  ON "users"("is_active");
CREATE INDEX IF NOT EXISTS "users_team_idx"       ON "users"("team");

-- 7. Foreign key tự tham chiếu manager_id -> users.id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_manager_id_fkey'
    ) THEN
        ALTER TABLE "users"
            ADD CONSTRAINT "users_manager_id_fkey"
            FOREIGN KEY ("manager_id") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
