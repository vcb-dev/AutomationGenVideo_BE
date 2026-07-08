-- Backfill owner_id / team_id cho huyk_channels dựa trên dữ liệu cũ (email, team_traffic).
-- Chạy SAU migration 20260708000000_add_owner_team_to_channels (đã thêm cột + FK).
-- An toàn: chỉ UPDATE các dòng match được; dòng không match giữ nguyên NULL, không có gì bị mất.

-- ============ BƯỚC 1: PREVIEW — chạy trước, KHÔNG đổi dữ liệu ============
-- Xem tổng quan tỉ lệ match trước khi backfill thật.
SELECT
  count(*) AS total_channels,
  count(*) FILTER (WHERE u.id IS NOT NULL) AS will_match_owner,
  count(*) FILTER (WHERE c.email IS NOT NULL AND c.email <> '' AND u.id IS NULL) AS owner_no_match,
  count(*) FILTER (WHERE t.id IS NOT NULL) AS will_match_team,
  count(*) FILTER (WHERE c.team_traffic IS NOT NULL AND c.team_traffic <> '' AND t.id IS NULL) AS team_no_match
FROM huyk_channels c
LEFT JOIN users u ON lower(trim(c.email)) = lower(trim(u.email))
LEFT JOIN teams t ON trim(c.team_traffic) = trim(t.name);

-- Chi tiết các giá trị email KHÔNG match được user nào (kiểm tra thủ công nếu cần)
SELECT DISTINCT c.email, count(*) AS num_channels
FROM huyk_channels c
LEFT JOIN users u ON lower(trim(c.email)) = lower(trim(u.email))
WHERE c.email IS NOT NULL AND c.email <> '' AND u.id IS NULL
GROUP BY c.email
ORDER BY num_channels DESC;

-- Chi tiết các giá trị team_traffic KHÔNG match được team nào (kiểm tra thủ công nếu cần)
SELECT DISTINCT c.team_traffic, count(*) AS num_channels
FROM huyk_channels c
LEFT JOIN teams t ON trim(c.team_traffic) = trim(t.name)
WHERE c.team_traffic IS NOT NULL AND c.team_traffic <> '' AND t.id IS NULL
GROUP BY c.team_traffic
ORDER BY num_channels DESC;

-- ============ BƯỚC 2: BACKFILL THẬT — chỉ chạy sau khi đã review kết quả Bước 1 ============
BEGIN;

UPDATE huyk_channels c
SET owner_id = u.id
FROM users u
WHERE lower(trim(c.email)) = lower(trim(u.email))
  AND c.owner_id IS NULL;

UPDATE huyk_channels c
SET team_id = t.id
FROM teams t
WHERE trim(c.team_traffic) = trim(t.name)
  AND c.team_id IS NULL;

COMMIT;

-- Sau khi chạy, có thể chạy lại SELECT ở Bước 1 để xác nhận will_match_owner / will_match_team
-- đã tăng đúng như kỳ vọng (owner_id / team_id giờ đã được điền).
