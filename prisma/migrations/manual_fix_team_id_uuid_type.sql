-- Migration: fix_team_id_uuid_type_mismatch
-- Fix lỗi "operator does not exist: uuid = text" khi Prisma join các bảng
-- có team_id kiểu TEXT với teams.id kiểu UUID.
-- Chuyển tất cả cột team_id (FK tới teams.id) từ TEXT sang UUID.

-- 1. tasks.team_id
ALTER TABLE "tasks" ALTER COLUMN "team_id" TYPE UUID USING "team_id"::UUID;

-- 2. team_products.team_id
ALTER TABLE "team_products" ALTER COLUMN "team_id" TYPE UUID USING "team_id"::UUID;

-- 3. team_contents.team_id
ALTER TABLE "team_contents" ALTER COLUMN "team_id" TYPE UUID USING "team_id"::UUID;

-- 4. team_sources.team_id
ALTER TABLE "team_sources" ALTER COLUMN "team_id" TYPE UUID USING "team_id"::UUID;

-- 5. team_push_requests.team_id
ALTER TABLE "team_push_requests" ALTER COLUMN "team_id" TYPE UUID USING "team_id"::UUID;

-- 6. team_kpis.team_id
ALTER TABLE "team_kpis" ALTER COLUMN "team_id" TYPE UUID USING "team_id"::UUID;

-- 7. sources.ordered_team_id
ALTER TABLE "sources" ALTER COLUMN "ordered_team_id" TYPE UUID USING "ordered_team_id"::UUID;
