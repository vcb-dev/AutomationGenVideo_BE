-- Chuyển cooldown từ từng sản phẩm sang cấu hình riêng của từng team.
CREATE TABLE "team_auto_assign_settings" (
  "team_id" UUID NOT NULL,
  "cooldown_days" INTEGER NOT NULL DEFAULT 5,
  "updated_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "team_auto_assign_settings_pkey" PRIMARY KEY ("team_id")
);

ALTER TABLE "team_auto_assign_settings"
  ADD CONSTRAINT "team_auto_assign_settings_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Giữ nguyên hành vi của từng team bằng giá trị cooldown chung hiện tại.
INSERT INTO "team_auto_assign_settings" ("team_id", "cooldown_days", "updated_at")
SELECT t."id", COALESCE(s."default_cooldown_days", 5), CURRENT_TIMESTAMP
FROM "teams" t
LEFT JOIN "auto_assign_settings" s ON s."id" = 1
ON CONFLICT ("team_id") DO NOTHING;

-- target_quantity = 0 nghĩa là không có quota cụ thể, vẫn được chia ở lane chia đều.
ALTER TABLE "team_product_warehouses"
  ALTER COLUMN "target_quantity" SET DEFAULT 0;

-- Các giá trị cooldown cũ không thể chuyển thành quota video vì khác ý nghĩa nghiệp vụ.
ALTER TABLE "products" DROP COLUMN IF EXISTS "cooldown_days";
ALTER TABLE "editor_products" DROP COLUMN IF EXISTS "cooldown_days";
ALTER TABLE "team_products" DROP COLUMN IF EXISTS "cooldown_days";
ALTER TABLE "auto_assign_settings" DROP COLUMN IF EXISTS "default_cooldown_days";
