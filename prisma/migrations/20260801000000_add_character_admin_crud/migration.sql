-- Hỗ trợ chức năng CRUD quản lý nhân vật (Character) qua UI admin: thêm cột theo dõi
-- "người sửa gần nhất" và bảng lưu lịch sử các bản cũ của system_prompt (bắt buộc, tránh
-- lặp lại sự cố mất dữ liệu do sửa prompt thủ công không có lưu vết trước đây).
--
-- KIỂU CỘT — đã đo bằng information_schema trên cả DB local lẫn production (2026-08-10):
--   users.id       = uuid   -> mọi cột *_by tham chiếu nó phải là UUID
--   characters.id  = text   -> character_id phải là TEXT
-- Bản trước của file này ghi chú "users.id là TEXT" và khai *_by là TEXT. Ghi chú đó SAI, và
-- hậu quả không hề im lặng: FK nổ ngay với mã 42804 "incompatible types: text and uuid" —
-- mà khối EXCEPTION bên dưới chỉ bắt duplicate_object nên KHÔNG nuốt được lỗi này, cả migration
-- chết theo. Đã dựng lại đúng lỗi đó trong transaction rollback trước khi sửa.
-- Kiểu ở đây khớp đúng schema.prisma: updated_by/changed_by đều `String? @db.Uuid`.

-- AlterTable
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "updated_by" UUID;

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
    "changed_by" UUID,
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
