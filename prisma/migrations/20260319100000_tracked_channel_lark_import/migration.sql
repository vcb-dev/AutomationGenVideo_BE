-- Hỗ trợ import kênh Lark → tracked_channels

ALTER TABLE "tracked_channels" ADD COLUMN IF NOT EXISTS "lark_channel_id" TEXT;
ALTER TABLE "tracked_channels" ADD COLUMN IF NOT EXISTS "added_via" TEXT NOT NULL DEFAULT 'manual';

-- Một bản ghi Lark (huyk_channels.id) chỉ tạo tối đa một tracked row. Nhiều dòng NULL = kênh nhập tay (PostgreSQL).
CREATE UNIQUE INDEX IF NOT EXISTS "tracked_channels_lark_channel_id_key"
  ON "tracked_channels" ("lark_channel_id");

CREATE INDEX IF NOT EXISTS "tracked_channels_added_via_idx" ON "tracked_channels" ("added_via");
