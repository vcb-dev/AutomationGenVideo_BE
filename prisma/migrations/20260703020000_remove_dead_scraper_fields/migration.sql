-- Remove confirmed-dead scraper fields/table (never written by live ingest code).
-- Scoped manually from `prisma migrate diff` output to exclude unrelated drift
-- (lark_kpi*, product_lines.brand_type, checklist_reports, etc.) already present
-- between schema.prisma and this database from other unrelated changes.

-- DropForeignKey
ALTER TABLE "scraper_tiktok_profile_metrics" DROP CONSTRAINT "scraper_tiktok_profile_metrics_profile_id_fkey";

-- DropIndex
DROP INDEX "scraper_douyin_videos_shortcode_key";

-- AlterTable
ALTER TABLE "scraper_douyin_profiles" DROP COLUMN "following_count",
DROP COLUMN "likes_count",
DROP COLUMN "videos_count";

-- AlterTable
ALTER TABLE "scraper_douyin_videos" DROP COLUMN "shortcode";

-- AlterTable
ALTER TABLE "scraper_fanpages" DROP COLUMN "header_image_drive_url",
DROP COLUMN "header_image_url";

-- AlterTable
ALTER TABLE "scraper_instagram_reels" DROP COLUMN "views_count";

-- AlterTable
ALTER TABLE "scraper_search_keywords" DROP COLUMN "raw_keyword";

-- AlterTable
ALTER TABLE "scraper_tiktok_profile_videos" DROP COLUMN "original_sound";

-- AlterTable
ALTER TABLE "scraper_tiktok_profiles" DROP COLUMN "account_created_at",
DROP COLUMN "avg_engagement_rate",
DROP COLUMN "comment_engagement_rate",
DROP COLUMN "is_commerce_user",
DROP COLUMN "like_engagement_rate",
DROP COLUMN "predicted_lang";

-- AlterTable
ALTER TABLE "scraper_tiktok_videos" DROP COLUMN "original_sound";

-- DropTable
DROP TABLE "scraper_tiktok_profile_metrics";
