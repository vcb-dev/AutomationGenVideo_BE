ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "lark_webhook_url" TEXT;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "lark_webhook_secret" TEXT;

CREATE TABLE IF NOT EXISTS "lark_webhook_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "webhook_url" TEXT,
    "webhook_secret" TEXT,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_webhook_settings_pkey" PRIMARY KEY ("id")
);
