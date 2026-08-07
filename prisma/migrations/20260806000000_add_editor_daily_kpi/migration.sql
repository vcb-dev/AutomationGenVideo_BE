-- CreateTable
CREATE TABLE "editor_daily_kpis" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "target" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "set_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editor_daily_kpis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "editor_daily_kpis_team_id_date_idx" ON "editor_daily_kpis"("team_id", "date");

-- CreateIndex
CREATE INDEX "editor_daily_kpis_date_idx" ON "editor_daily_kpis"("date");

-- CreateIndex
CREATE UNIQUE INDEX "editor_daily_kpis_user_id_team_id_date_key" ON "editor_daily_kpis"("user_id", "team_id", "date");

-- AddForeignKey
ALTER TABLE "editor_daily_kpis" ADD CONSTRAINT "editor_daily_kpis_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_daily_kpis" ADD CONSTRAINT "editor_daily_kpis_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_daily_kpis" ADD CONSTRAINT "editor_daily_kpis_set_by_id_fkey" FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
