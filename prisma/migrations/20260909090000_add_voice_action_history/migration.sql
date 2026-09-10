-- CreateTable
CREATE TABLE IF NOT EXISTS "voice_action_histories" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "action_type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    "voice_id" VARCHAR(255),
    "voice_name" VARCHAR(255),
    "input_text" TEXT,
    "output_url" TEXT,
    "characters" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_action_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "voice_action_histories_user_id_idx" ON "voice_action_histories"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "voice_action_histories_action_type_idx" ON "voice_action_histories"("action_type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "voice_action_histories_status_idx" ON "voice_action_histories"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "voice_action_histories_created_at_idx" ON "voice_action_histories"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "voice_action_histories_user_id_created_at_idx" ON "voice_action_histories"("user_id", "created_at");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'voice_action_histories_user_id_fkey'
  ) THEN
    ALTER TABLE "voice_action_histories" ADD CONSTRAINT "voice_action_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
