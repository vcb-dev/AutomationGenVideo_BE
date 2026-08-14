-- Hỗ trợ chức năng CRUD quản lý nhân vật (Character) qua UI admin: thêm cột theo dõi
-- "người sửa gần nhất" và bảng lưu lịch sử các bản cũ của system_prompt (bắt buộc, tránh
-- lặp lại sự cố mất dữ liệu do sửa prompt thủ công không có lưu vết trước đây).
--
-- LƯU Ý: public.users.id là kiểu TEXT trên DB thật (không phải UUID như schema.prisma khai
-- báo cho User.id/ContentTransformHistory.user_id — đó là drift có sẵn từ trước, xác nhận qua
-- information_schema + FK content_transform_histories_user_id_fkey đang hoạt động với cột
-- user_id kiểu text). Các cột *_by dưới đây dùng TEXT để khớp đúng thực tế, tránh lỗi
-- "incompatible types: uuid and text" khi tạo foreign key.

-- AlterTable
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "updated_by" TEXT;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "characters" ADD CONSTRAINT "characters_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "character_system_prompt_history" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "old_content" TEXT NOT NULL,
    "changed_by" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_system_prompt_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "character_system_prompt_history_character_id_idx" ON "character_system_prompt_history"("character_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "character_system_prompt_history_changed_at_idx" ON "character_system_prompt_history"("changed_at");

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "character_system_prompt_history" ADD CONSTRAINT "character_system_prompt_history_character_id_fkey"
    FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "character_system_prompt_history" ADD CONSTRAINT "character_system_prompt_history_changed_by_fkey"
    FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
