-- Content creator per-team member feature: mọi team (không chỉ team_kind=CONTENT) có thể đánh dấu
-- từng thành viên là content creator, thêm content vào kho team với lựa chọn sưu tầm/tự nghĩ, và
-- có KPI ngày riêng (mirror EditorDailyKpi). Toàn bộ additive: enum mới, cột có default/nullable,
-- 1 bảng mới — không rename/drop, an toàn dữ liệu, không ảnh hưởng team_kind=CONTENT hiện có.

-- CreateEnum
CREATE TYPE "ContentOrigin" AS ENUM ('COLLECTED', 'SELF_CREATED');

-- AlterTable
ALTER TABLE "team_members" ADD COLUMN     "is_content_creator" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "team_contents" ADD COLUMN     "origin" "ContentOrigin";

-- AlterTable
ALTER TABLE "contents" ADD COLUMN     "origin" "ContentOrigin";

-- CreateTable
CREATE TABLE "content_creator_daily_kpis" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "target" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "set_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_creator_daily_kpis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_creator_daily_kpis_team_id_date_idx" ON "content_creator_daily_kpis"("team_id", "date");

-- CreateIndex
CREATE INDEX "content_creator_daily_kpis_date_idx" ON "content_creator_daily_kpis"("date");

-- CreateIndex
CREATE UNIQUE INDEX "content_creator_daily_kpis_user_id_team_id_date_key" ON "content_creator_daily_kpis"("user_id", "team_id", "date");

-- AddForeignKey
ALTER TABLE "content_creator_daily_kpis" ADD CONSTRAINT "content_creator_daily_kpis_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_creator_daily_kpis" ADD CONSTRAINT "content_creator_daily_kpis_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_creator_daily_kpis" ADD CONSTRAINT "content_creator_daily_kpis_set_by_id_fkey" FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
