-- Content Creator feature: team_kind cho Team, ContentTranslation, ContentCreatorKpi (target tháng thủ công).
-- Toàn bộ additive: enum mới, cột có default, 2 bảng mới — không rename/drop, an toàn dữ liệu.

-- CreateEnum
CREATE TYPE "TeamKind" AS ENUM ('PRODUCTION', 'CONTENT');

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "team_kind" "TeamKind" NOT NULL DEFAULT 'PRODUCTION';

-- CreateTable
CREATE TABLE "content_translations" (
    "id" TEXT NOT NULL,
    "content_id" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "script" TEXT,
    "translated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_creator_kpis" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "content_target" INTEGER NOT NULL DEFAULT 0,
    "translation_target" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "set_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_creator_kpis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_translations_content_id_idx" ON "content_translations"("content_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_translations_content_id_market_key" ON "content_translations"("content_id", "market");

-- CreateIndex
CREATE INDEX "content_creator_kpis_month_idx" ON "content_creator_kpis"("month");

-- CreateIndex
CREATE INDEX "content_creator_kpis_team_id_idx" ON "content_creator_kpis"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_creator_kpis_user_id_team_id_month_key" ON "content_creator_kpis"("user_id", "team_id", "month");

-- AddForeignKey
ALTER TABLE "content_translations" ADD CONSTRAINT "content_translations_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_translations" ADD CONSTRAINT "content_translations_translated_by_id_fkey" FOREIGN KEY ("translated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_creator_kpis" ADD CONSTRAINT "content_creator_kpis_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_creator_kpis" ADD CONSTRAINT "content_creator_kpis_set_by_id_fkey" FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_creator_kpis" ADD CONSTRAINT "content_creator_kpis_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
