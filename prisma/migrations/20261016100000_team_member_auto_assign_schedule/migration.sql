-- Leader bật/tắt chia task tự động (task A4 + Kế hoạch ngày) cho từng thành viên và chọn từng ngày
-- Thứ 2 → Chủ nhật, thay cho nút "Chạy vào cuối tuần" chung toàn hệ thống.
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "auto_assign_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "auto_assign_weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[];

-- Giữ đúng hành vi đang chạy: hệ thống đang tắt cuối tuần thì mọi thành viên hiện có chỉ được chia T2–T6.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'auto_assign_settings' AND column_name = 'weekend_enabled'
  ) THEN
    EXECUTE 'UPDATE "team_members" SET "auto_assign_weekdays" = ARRAY[1, 2, 3, 4, 5]
             WHERE EXISTS (SELECT 1 FROM "auto_assign_settings" WHERE "weekend_enabled" = false)';
  END IF;
END $$;

ALTER TABLE "auto_assign_settings" DROP COLUMN IF EXISTS "weekend_enabled";
