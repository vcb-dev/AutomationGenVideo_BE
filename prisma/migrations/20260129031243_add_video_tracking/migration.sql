-- CreateTable
CREATE TABLE "videos" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "thumbnail_url" TEXT,
    "duration" INTEGER,
    "file_size" BIGINT,
    "content_hash" TEXT NOT NULL,
    "metadata_hash" TEXT,
    "total_posts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_posts" (
    "id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platform_video_id" TEXT,
    "platform_url" TEXT,
    "title" TEXT,
    "description" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "views" BIGINT NOT NULL DEFAULT 0,
    "likes" BIGINT NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "videos_content_hash_key" ON "videos"("content_hash");

-- CreateIndex
CREATE INDEX "videos_user_id_idx" ON "videos"("user_id");

-- CreateIndex
CREATE INDEX "videos_content_hash_idx" ON "videos"("content_hash");

-- CreateIndex
CREATE INDEX "videos_created_at_idx" ON "videos"("created_at");

-- CreateIndex
CREATE INDEX "video_posts_video_id_idx" ON "video_posts"("video_id");

-- CreateIndex
CREATE INDEX "video_posts_channel_id_idx" ON "video_posts"("channel_id");

-- CreateIndex
CREATE INDEX "video_posts_platform_idx" ON "video_posts"("platform");

-- CreateIndex
CREATE INDEX "video_posts_posted_at_idx" ON "video_posts"("posted_at");

-- CreateIndex
CREATE UNIQUE INDEX "video_posts_video_id_channel_id_key" ON "video_posts"("video_id", "channel_id");

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_posts" ADD CONSTRAINT "video_posts_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_posts" ADD CONSTRAINT "video_posts_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "tracked_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
