-- CreateTable
CREATE TABLE IF NOT EXISTS "scraper_hidden_videos" (
    "id" TEXT NOT NULL,
    "platform" VARCHAR(50) NOT NULL,
    "post_id" VARCHAR(100) NOT NULL,
    "user_id" UUID,
    "reason" TEXT DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_hidden_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "scraper_hidden_videos_platform_post_id_key" ON "scraper_hidden_videos"("platform", "post_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "scraper_hidden_videos_platform_post_id_idx" ON "scraper_hidden_videos"("platform", "post_id");
