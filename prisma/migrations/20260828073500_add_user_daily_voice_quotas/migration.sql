-- CreateTable
CREATE TABLE IF NOT EXISTS "user_daily_voice_quotas" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "default_limit" INTEGER NOT NULL DEFAULT 8,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "granted_extra" INTEGER NOT NULL DEFAULT 0,
    "granted_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_daily_voice_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_daily_voice_quotas_user_id_date_key" ON "user_daily_voice_quotas"("user_id", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_daily_voice_quotas_user_id_idx" ON "user_daily_voice_quotas"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_daily_voice_quotas_date_idx" ON "user_daily_voice_quotas"("date");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'user_daily_voice_quotas_user_id_fkey'
  ) THEN
    ALTER TABLE "user_daily_voice_quotas" ADD CONSTRAINT "user_daily_voice_quotas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
