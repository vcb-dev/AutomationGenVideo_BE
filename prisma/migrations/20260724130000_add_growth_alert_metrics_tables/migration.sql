-- CreateTable
CREATE TABLE "scraper_tiktok_profile_metrics" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" BIGINT NOT NULL,
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "following_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_tiktok_profile_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_douyin_profile_metrics" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" BIGINT NOT NULL,
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_douyin_profile_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_kuaishou_profile_metrics" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" BIGINT NOT NULL,
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "following_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_kuaishou_profile_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_bilibili_profile_metrics" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" BIGINT NOT NULL,
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "following_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_bilibili_profile_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_youtube_profile_metrics" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" BIGINT NOT NULL,
    "subscriber_count" BIGINT NOT NULL DEFAULT 0,
    "video_count" INTEGER NOT NULL DEFAULT 0,
    "view_count" BIGINT NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_youtube_profile_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scraper_tiktok_profile_metrics_profile_id_captured_at_idx" ON "scraper_tiktok_profile_metrics"("profile_id", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "scraper_douyin_profile_metrics_profile_id_captured_at_idx" ON "scraper_douyin_profile_metrics"("profile_id", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "scraper_kuaishou_profile_metrics_profile_id_captured_at_idx" ON "scraper_kuaishou_profile_metrics"("profile_id", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "scraper_bilibili_profile_metrics_profile_id_captured_at_idx" ON "scraper_bilibili_profile_metrics"("profile_id", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "scraper_youtube_profile_metrics_profile_id_captured_at_idx" ON "scraper_youtube_profile_metrics"("profile_id", "captured_at" DESC);

-- AddForeignKey
ALTER TABLE "scraper_tiktok_profile_metrics" ADD CONSTRAINT "scraper_tiktok_profile_metrics_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_tiktok_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_douyin_profile_metrics" ADD CONSTRAINT "scraper_douyin_profile_metrics_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_douyin_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_kuaishou_profile_metrics" ADD CONSTRAINT "scraper_kuaishou_profile_metrics_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_kuaishou_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_bilibili_profile_metrics" ADD CONSTRAINT "scraper_bilibili_profile_metrics_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_bilibili_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_youtube_profile_metrics" ADD CONSTRAINT "scraper_youtube_profile_metrics_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "scraper_youtube_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
