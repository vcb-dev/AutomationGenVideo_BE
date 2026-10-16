-- Page không có tên rút gọn (facebook.com/p/<Tên>-<id>/, /people/<Tên>/<id>/, profile.php?id=)
-- từng bị AI ghi đoạn path cố định "p"/"people"/"profile.php" vào handle, nên Khám phá kênh
-- hiện "@p". Xoá về rỗng — FE hiện profile_id khi không có handle; lượt cào sau không ghi lại
-- nữa (BE bỏ qua handle không phải tên page).
UPDATE "scraper_fanpages"
SET "handle" = ''
WHERE lower("handle") IN ('p', 'people', 'pages', 'pg', 'profile.php', 'share', 'watch', 'reel', 'reels', 'groups');
