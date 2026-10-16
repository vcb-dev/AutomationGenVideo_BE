-- Tag chủ đề của bài Threads (dòng "người đăng > trang sức"), để tìm/lọc bài theo tag.
ALTER TABLE "scraper_threads_posts" ADD COLUMN "topic_tag" VARCHAR(255) NOT NULL DEFAULT '';

CREATE INDEX "scraper_threads_posts_topic_tag_idx" ON "scraper_threads_posts"("topic_tag");
