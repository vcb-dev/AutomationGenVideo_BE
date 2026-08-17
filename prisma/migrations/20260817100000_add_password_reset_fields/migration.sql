-- AlterTable: thêm cột hỗ trợ reset password bằng OTP
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_token_hash" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_token_expires" TIMESTAMP(3);
