-- CreateTable
CREATE TABLE "ai_voice_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "voice_id" VARCHAR(255),
    "characters" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "job_id" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_voice_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_voice_usage_job_id_key" ON "ai_voice_usage"("job_id");

-- CreateIndex
CREATE INDEX "ai_voice_usage_user_id_idx" ON "ai_voice_usage"("user_id");

-- CreateIndex
CREATE INDEX "ai_voice_usage_created_at_idx" ON "ai_voice_usage"("created_at");

-- CreateIndex
CREATE INDEX "ai_voice_usage_kind_idx" ON "ai_voice_usage"("kind");

-- AddForeignKey
ALTER TABLE "ai_voice_usage" ADD CONSTRAINT "ai_voice_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
