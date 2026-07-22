-- Lưu danh sách link bài đăng editor tự đăng tay (nền tảng tự do, không cố định), độc lập với
-- social_posts (chỉ dùng cho auto-post qua tài khoản API-connected)
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "published_links" JSONB;
