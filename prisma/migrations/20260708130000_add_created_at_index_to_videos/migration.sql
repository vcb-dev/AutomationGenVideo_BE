-- CreateIndex
CREATE INDEX "scraper_tiktok_videos_created_at_idx" ON "scraper_tiktok_videos"("created_at" DESC);

-- CreateIndex
CREATE INDEX "scraper_douyin_videos_created_at_idx" ON "scraper_douyin_videos"("created_at" DESC);

-- CreateIndex
CREATE INDEX "scraper_xiaohongshu_videos_created_at_idx" ON "scraper_xiaohongshu_videos"("created_at" DESC);
