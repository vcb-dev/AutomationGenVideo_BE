-- Thêm cột theo dõi token/chi phí AI cho content_transform_histories — phục vụ khối "Chi phí AI"
-- ở tab Thống kê Chuyển đổi nội dung (tổng chi phí cả team + chi phí từng thành viên).
--
-- NULLABLE, không có default: bản ghi cũ tạo trước migration này không có số liệu token thật,
-- để NULL thay vì 0 để FE phân biệt được "chưa theo dõi" với "tốn $0" (xem TeamStatsTab.tsx).
--
-- input_tokens/output_tokens: tổng token THẬT đã dùng cho bản ghi này, cộng dồn qua các lượt gọi
-- AI liên quan (viết ở /transform, rồi CỘNG THÊM lượt chấm ở /rescore nếu có — xem
-- rescoreContent() bên ai-integration.service.ts).
--
-- cost_usd: Decimal(10,6) — đủ chính xác cho vài phần triệu đô, 1 lượt chuyển đổi thường dưới $1.

ALTER TABLE "content_transform_histories"
  ADD COLUMN "input_tokens" INTEGER,
  ADD COLUMN "output_tokens" INTEGER,
  ADD COLUMN "cost_usd" DECIMAL(10, 6);
