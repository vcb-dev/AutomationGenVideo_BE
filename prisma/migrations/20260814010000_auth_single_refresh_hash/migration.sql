-- Chuyển refresh token từ bảng riêng (refresh_tokens, rotation theo family) sang một cột hash
-- duy nhất trên users (single-session, khớp cấu trúc auth.service.ts mới).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "refresh_token_hash" TEXT;

-- DropTable
DROP TABLE "refresh_tokens";
