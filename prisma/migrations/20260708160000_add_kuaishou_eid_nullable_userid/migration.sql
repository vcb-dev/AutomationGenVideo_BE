-- Fix ID-space mismatch: fetch_user_info/fetch_one_user_v2 dùng eid (chuỗi từ
-- URL profile), fetch_user_hot_post dùng user_id numeric — 2 định danh khác
-- nhau cho cùng 1 tài khoản. Bảng đang rỗng (tính năng chưa release) nên ALTER
-- trực tiếp không cần backfill.

-- AlterTable
ALTER TABLE "scraper_kuaishou_profiles" ADD COLUMN "eid" VARCHAR(50) NOT NULL;
ALTER TABLE "scraper_kuaishou_profiles" ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "scraper_kuaishou_profiles_eid_key" ON "scraper_kuaishou_profiles"("eid");
