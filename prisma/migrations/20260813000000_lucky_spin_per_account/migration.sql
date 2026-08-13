-- Vòng quay may mắn: tách dữ liệu theo từng tài khoản, không dùng chung toàn công ty nữa.
--
-- Bốn bước phải giữ đúng thứ tự này: thêm cột cho NULL → lấp dữ liệu cũ → siết NOT NULL →
-- đổi ràng buộc duy nhất. Đảo bước 2 với bước 3 là migration đổ ngay vì các dòng đang có
-- chưa kịp có chủ.

-- 1. Thêm cột chủ sở hữu. Tạm cho NULL để không chặn các dòng sẵn có.
ALTER TABLE "spin_workspaces" ADD COLUMN "owner_id" UUID;

-- 2. Dữ liệu đang có (seci và tridao: 37 thành viên, 13 team, 118 lượt quay, 11 lần trúng) gán
--    cho Bùi Minh Hiền <minhhienvienchibao@gmail.com> — người thật sự chạy các buổi sự kiện
--    (44 thao tác, dùng tới tận rạng sáng 2026-08-13). testadmin tuy nhiều thao tác hơn nhưng
--    là tài khoản kiểm thử, không phải người tổ chức.
--
--    Không xoá dòng nào. Gán nhầm chủ thì đổi bằng một câu UPDATE trực tiếp trên bảng này,
--    không cần migration mới.
UPDATE "spin_workspaces"
SET "owner_id" = '7724cb0f-1666-46e3-b885-23cf97f20bdf'
WHERE "owner_id" IS NULL;

-- 3. Từ đây mọi vòng quay đều phải có chủ — không còn đường nào tạo ra vòng quay vô chủ mà cả
--    công ty cùng nhìn thấy.
ALTER TABLE "spin_workspaces" ALTER COLUMN "owner_id" SET NOT NULL;

-- 4. slug một mình không còn là duy nhất: mỗi tài khoản có bản riêng của từng slug.
DROP INDEX IF EXISTS "spin_workspaces_slug_key";
CREATE UNIQUE INDEX IF NOT EXISTS "spin_workspaces_slug_owner_id_key"
  ON "spin_workspaces"("slug", "owner_id");
