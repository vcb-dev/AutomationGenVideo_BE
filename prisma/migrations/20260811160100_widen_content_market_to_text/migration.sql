-- Content.market trước đây là enum ContentMarket (chỉ GLOBAL|VIETNAM) — không cho phép lưu
-- content với thị trường Indonesia/Nhật Bản/Thái Lan dù FE form đã cho chọn từ trước (bug).
-- Đổi sang TEXT tự do, cùng quy ước TEAM_MARKETS với Team.market/TeamContent.market/EditorContent.market.

-- AlterTable
ALTER TABLE "contents" ALTER COLUMN "market" DROP DEFAULT;
ALTER TABLE "contents" ALTER COLUMN "market" TYPE TEXT USING "market"::TEXT;
ALTER TABLE "contents" ALTER COLUMN "market" SET DEFAULT 'VIETNAM';

-- DropEnum
DROP TYPE "ContentMarket";
