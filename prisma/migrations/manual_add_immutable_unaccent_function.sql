-- Phase 1 của lộ trình "đẩy filter search (q) xuống DB, có index" —
-- xem báo cáo audit index/query trong phiên làm việc.
--
-- Postgres's unaccent() (từ extension "unaccent") được đánh dấu STABLE, không
-- phải IMMUTABLE — nên KHÔNG thể tạo index trực tiếp trên unaccent(column).
-- Wrapper dưới đây tự đánh dấu IMMUTABLE (an toàn trong thực tế vì dictionary
-- 'unaccent' không đổi lúc runtime), cho phép tạo GIN trigram index ở Phase 2.
--
-- Mirror chính xác logic bên Node (common/utils/unaccent.util.ts::unaccent):
--   text.normalize('NFD').replace(COMBINING_MARKS, '').replace(/đ/g,'d').replace(/Đ/g,'D')
-- unaccent('unaccent', text) xử lý phần dấu Latin chuẩn (á/à/ả/ã/ạ -> a, ê/ế... -> e, ...).
-- translate(...,'đĐ','dD') xử lý riêng đ/Đ — KHÔNG tách được qua NFD, y hệt lý do
-- Node phải .replace riêng 2 ký tự này sau bước normalize.
--
-- ⚠️ CẦN VERIFY bằng query thực tế trên DB (chưa test được vì không có Postgres
-- local reachable lúc viết migration này) trước khi dùng làm điều kiện WHERE ở
-- Phase 3 — so sánh output hàm này với unaccentMatch() bên Node cho vài chuỗi
-- tiếng Việt có dấu thực tế trong dữ liệu (tên page, caption, nickname...).

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION immutable_unaccent(input text)
RETURNS text AS $$
  SELECT translate(
    unaccent('unaccent'::regdictionary, input),
    'đĐ',
    'dD'
  );
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;
