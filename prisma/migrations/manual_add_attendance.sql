-- Migration: Add Attendance Feature
-- Tables: meeting_sessions, attendance_records
-- Enum: AttendanceStatus

-- 1. Tạo enum AttendanceStatus
DO $$ BEGIN
  CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'ON_LEAVE', 'LATE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Tạo bảng meeting_sessions
CREATE TABLE IF NOT EXISTS "meeting_sessions" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "team_id"      TEXT NOT NULL,
  "period_id"    TEXT NOT NULL,
  "title"        TEXT,
  "scheduled_at" TIMESTAMP(3) NOT NULL,
  "notes"        TEXT,
  "created_by"   TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "meeting_sessions_pkey" PRIMARY KEY ("id")
);

-- Unique: 1 session / team / kỳ tuần
ALTER TABLE "meeting_sessions"
  ADD CONSTRAINT "meeting_sessions_team_id_period_id_key" UNIQUE ("team_id", "period_id");

-- Indexes
CREATE INDEX IF NOT EXISTS "meeting_sessions_team_id_idx"   ON "meeting_sessions"("team_id");
CREATE INDEX IF NOT EXISTS "meeting_sessions_period_id_idx" ON "meeting_sessions"("period_id");

-- Foreign keys
ALTER TABLE "meeting_sessions"
  ADD CONSTRAINT "meeting_sessions_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "meeting_sessions"
  ADD CONSTRAINT "meeting_sessions_period_id_fkey"
    FOREIGN KEY ("period_id") REFERENCES "report_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "meeting_sessions"
  ADD CONSTRAINT "meeting_sessions_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Tạo bảng attendance_records
CREATE TABLE IF NOT EXISTS "attendance_records" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "session_id"   TEXT NOT NULL,
  "user_id"      TEXT NOT NULL,
  "status"       "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
  "note"         TEXT,
  "marked_by_id" TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- Unique: 1 bản ghi / người / buổi → basis upsert
ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_session_id_user_id_key" UNIQUE ("session_id", "user_id");

-- Indexes
CREATE INDEX IF NOT EXISTS "attendance_records_user_id_idx"    ON "attendance_records"("user_id");
CREATE INDEX IF NOT EXISTS "attendance_records_session_id_idx" ON "attendance_records"("session_id");

-- Foreign keys
ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_marked_by_id_fkey"
    FOREIGN KEY ("marked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Trigger updated_at tự động cho meeting_sessions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$ BEGIN
  CREATE TRIGGER "meeting_sessions_updated_at"
    BEFORE UPDATE ON "meeting_sessions"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER "attendance_records_updated_at"
    BEFORE UPDATE ON "attendance_records"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
