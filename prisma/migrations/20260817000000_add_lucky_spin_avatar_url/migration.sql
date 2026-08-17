-- Thêm cột avatar_url cho thành viên và lịch sử trúng giải của Vòng quay may mắn
ALTER TABLE "spin_members" ADD COLUMN IF NOT EXISTS "avatar_url" TEXT;
ALTER TABLE "spin_member_wins" ADD COLUMN IF NOT EXISTS "avatar_url" TEXT;
