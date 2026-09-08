-- Tách ảnh chứng cứ của biên bản khỏi ảnh hồ sơ của máy.
--
-- Mỗi lượt bàn giao và nhận trả đều tải ảnh lên qua chính endpoint ảnh thiết bị, nên chúng nằm
-- lẫn trong thư viện ảnh của máy: mượn 20 lần là 60 tấm ảnh biên bản đứng cạnh ảnh catalogue, và
-- ảnh đại diện ở bảng kho có thể rơi trúng một tấm chụp vết xước.
--
-- Mặc định CATALOG nên mọi dòng đang có giữ nguyên ý nghĩa cũ; cột chỉ đổi hành vi cho ảnh tải
-- lên từ nay về sau.
ALTER TABLE "mems_asset_photos"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'CATALOG';

CREATE INDEX "mems_asset_photos_asset_id_purpose_idx"
  ON "mems_asset_photos"("asset_id", "purpose");
