-- Merge lark_employees into users; drop avatar/ma_pin when done.
-- An toàn nếu bảng lark_employees không còn hoặc migration chưa từng chạy hết.

-- 1) Cột mới trên users (idempotent)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lark_employee_record_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "image_url" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_data" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_position" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_status" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_date" TIMESTAMP(3);

-- 2) Copy avatar -> image_url nếu còn cột avatar
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'avatar'
  ) THEN
    UPDATE "users" SET "image_url" = "avatar" WHERE "image_url" IS NULL AND "avatar" IS NOT NULL;
  END IF;
END $$;

-- 3–5) Chỉ khi còn bảng lark_employees
DO $$
BEGIN
  IF to_regclass('public.lark_employees') IS NULL THEN
    RETURN;
  END IF;

  -- Match users theo tên
  EXECUTE $sync$
    WITH emp_dedup AS (
      SELECT DISTINCT ON (LOWER(TRIM("name")))
        "id", "employee_id", "name", "image_url", "employee_data", "position", "team", "status", "date"
      FROM "lark_employees"
      ORDER BY LOWER(TRIM("name")), "updated_at" DESC NULLS LAST
    )
    UPDATE "users" u SET
      "lark_employee_record_id" = e."id",
      "employee_id" = e."employee_id",
      "image_url" = COALESCE(u."image_url", e."image_url"),
      "employee_data" = e."employee_data",
      "employee_position" = e."position",
      "team" = COALESCE(e."team", u."team"),
      "employee_status" = e."status",
      "employee_date" = e."date"
    FROM emp_dedup e
    WHERE LOWER(TRIM(u."full_name")) = LOWER(TRIM(e."name"))
  $sync$;

  -- User tổng hợp cho dòng Lark chưa khớp
  EXECUTE $ins$
    INSERT INTO "users" (
      "id", "email", "full_name", "password_hash", "roles", "is_active",
      "created_at", "updated_at", "last_app_update_at",
      "lark_employee_record_id", "employee_id", "image_url", "employee_data",
      "employee_position", "team", "employee_status", "employee_date"
    )
    SELECT
      gen_random_uuid()::text,
      'lark-' || REPLACE(REPLACE(e."id", ' ', '_'), '/', '_') || '@employee.vcb.internal',
      e."name",
      NULL,
      ARRAY['MEMBER']::"UserRole"[],
      true,
      NOW(),
      NOW(),
      NOW(),
      e."id",
      e."employee_id",
      e."image_url",
      e."employee_data",
      e."position",
      e."team",
      e."status",
      e."date"
    FROM "lark_employees" e
    WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."lark_employee_record_id" = e."id")
      AND (
        e."employee_id" IS NULL
        OR NOT EXISTS (SELECT 1 FROM "users" u2 WHERE u2."employee_id" IS NOT NULL AND u2."employee_id" = e."employee_id")
      )
  $ins$;

  DROP TABLE "lark_employees";
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "users_lark_employee_record_id_key" ON "users"("lark_employee_record_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_employee_id_key" ON "users"("employee_id");

ALTER TABLE "users" DROP COLUMN IF EXISTS "avatar";
ALTER TABLE "users" DROP COLUMN IF EXISTS "ma_pin";
