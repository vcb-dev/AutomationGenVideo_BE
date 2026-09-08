-- Tách hạn giữ chỗ của worker ra khỏi next_retry_at.
--
-- Trước đây next_retry_at gánh 2 vai trò: vừa là hạn giữ chỗ khi worker nhận bài
-- (now + 40 phút), vừa là mốc chạy lại sau khi đăng lỗi (backoff 5 và 15 phút).
-- Bộ đếm "đang xử lý" lọc next_retry_at trong khoảng (now, now+40'] nên MỌI bài
-- đang chờ retry đều bị đếm nhầm là đang chạy → ăn slot đồng thời, và với
-- SOCIAL_ACCOUNT_CONCURRENCY=1 thì một bài lỗi khoá cả kênh suốt 5-15 phút.
-- Người dùng cũng không sửa/huỷ được bài vừa lỗi vì hai API đó coi
-- next_retry_at > now là "đang được xử lý".
--
-- Cột mới chỉ mang nghĩa giữ chỗ, được worker gia hạn định kỳ bằng heartbeat.
-- TIMESTAMPTZ chứ không phải TIMESTAMP: cả 5 cột thời gian sẵn có của social_posts
-- (scheduled_at, executed_at, next_retry_at, created_at, updated_at) đều là
-- "timestamp with time zone". Dùng lệch kiểu thì `claimed_until > now()` được diễn giải
-- theo múi giờ phiên DB trong khi `next_retry_at > now()` theo UTC — hai mốc so sánh
-- trong cùng một truy vấn claim sẽ lệch nhau.
ALTER TABLE "social_posts" ADD COLUMN "claimed_until" TIMESTAMPTZ(3);

CREATE INDEX "social_posts_claimed_until_idx" ON "social_posts"("claimed_until");

-- Bài đang PENDING có next_retry_at ở tương lai lúc deploy là trạng thái nhập nhằng:
-- không phân biệt được đó là giữ chỗ của worker hay backoff sau lỗi. Để nguyên
-- next_retry_at và KHÔNG suy ra claimed_until — worst case bài chờ thêm tối đa 40
-- phút rồi chạy bình thường, an toàn hơn là đoán sai rồi đăng trùng.
