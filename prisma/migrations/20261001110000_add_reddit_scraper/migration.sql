-- Reddit (Khám phá kênh): cộng đồng (subreddit) đã lưu + bài viết tìm theo từ khoá / cào theo cộng đồng.
-- Xoá cộng đồng thì xoá luôn bài của nó (như các nền tảng khác); bài tìm theo từ khoá không gắn cộng đồng thì giữ.

-- CreateTable
CREATE TABLE "scraper_reddit_subreddits" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "display_name" VARCHAR(60) NOT NULL DEFAULT '',
    "title" VARCHAR(500) NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "icon_url" TEXT,
    "subscribers_count" BIGINT NOT NULL DEFAULT 0,
    "is_nsfw" BOOLEAN NOT NULL DEFAULT false,
    "last_scraped_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_reddit_subreddits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_reddit_posts" (
    "id" BIGSERIAL NOT NULL,
    "post_id" VARCHAR(20) NOT NULL,
    "subreddit_id" BIGINT,
    "subreddit_name" VARCHAR(50) NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "url" VARCHAR(1000) NOT NULL,
    "link_url" TEXT,
    "author" VARCHAR(100) NOT NULL DEFAULT '',
    "author_avatar" TEXT,
    "media_type" VARCHAR(20) NOT NULL DEFAULT 'TEXT',
    "thumbnail_url" TEXT,
    "video_url" TEXT,
    "score" BIGINT NOT NULL DEFAULT 0,
    "comments_count" BIGINT NOT NULL DEFAULT 0,
    "upvote_ratio" DOUBLE PRECISION,
    "is_nsfw" BOOLEAN NOT NULL DEFAULT false,
    "search_keyword" VARCHAR(255) NOT NULL DEFAULT '',
    "date_posted" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scraper_reddit_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scraper_reddit_subreddits_name_key" ON "scraper_reddit_subreddits"("name");

-- CreateIndex
CREATE UNIQUE INDEX "scraper_reddit_posts_post_id_key" ON "scraper_reddit_posts"("post_id");

-- CreateIndex
CREATE INDEX "scraper_reddit_posts_subreddit_id_idx" ON "scraper_reddit_posts"("subreddit_id");

-- CreateIndex
CREATE INDEX "scraper_reddit_posts_subreddit_name_idx" ON "scraper_reddit_posts"("subreddit_name");

-- CreateIndex
CREATE INDEX "scraper_reddit_posts_date_posted_idx" ON "scraper_reddit_posts"("date_posted" DESC);

-- CreateIndex
CREATE INDEX "scraper_reddit_posts_score_idx" ON "scraper_reddit_posts"("score" DESC);

-- AddForeignKey
ALTER TABLE "scraper_reddit_posts" ADD CONSTRAINT "scraper_reddit_posts_subreddit_id_fkey" FOREIGN KEY ("subreddit_id") REFERENCES "scraper_reddit_subreddits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

