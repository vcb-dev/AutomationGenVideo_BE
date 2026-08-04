-- ScraperVideoProposal: hàng đợi duyệt video (từ scraper đã cào hoặc member tự
-- dán URL) trước khi vào video_library. Mirror team_push_requests, nhưng
-- requested_by_id/reviewed_by_id dùng UUID ngay từ đầu (không TEXT) — tránh lặp
-- lại lỗi "operator does not exist: uuid = text" đã từng xảy ra với các cột
-- team_id trỏ sang teams.id (xem manual_fix_team_id_uuid_type.sql), vì users.id
-- cũng là UUID native trong DB thật.

CREATE TYPE "ProposalSource" AS ENUM ('SCRAPED', 'MANUAL');

CREATE TABLE "scraper_video_proposals" (
    "id" TEXT NOT NULL,
    "video_id" VARCHAR(255) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "video_url" VARCHAR(2000) NOT NULL,
    "author_username" VARCHAR(255) NOT NULL DEFAULT '',
    "author_name" VARCHAR(255) NOT NULL DEFAULT '',
    "thumbnail_url" VARCHAR(2000),
    "views_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "comments_count" BIGINT NOT NULL DEFAULT 0,
    "shares_count" BIGINT NOT NULL DEFAULT 0,
    "source" "ProposalSource" NOT NULL DEFAULT 'SCRAPED',
    "notes" TEXT,
    "requested_by_id" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_video_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scraper_video_proposals_status_created_at_idx" ON "scraper_video_proposals"("status", "created_at" DESC);
CREATE INDEX "scraper_video_proposals_requested_by_id_idx" ON "scraper_video_proposals"("requested_by_id");

ALTER TABLE "scraper_video_proposals" ADD CONSTRAINT "scraper_video_proposals_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scraper_video_proposals" ADD CONSTRAINT "scraper_video_proposals_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
