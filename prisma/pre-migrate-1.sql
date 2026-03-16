-- Bước 1: Thêm MEMBER vào enum cũ (chạy trong transaction riêng)
-- Sau khi commit, MEMBER sẽ visible cho các connection tiếp theo
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MEMBER';
