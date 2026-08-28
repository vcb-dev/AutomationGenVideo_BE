-- Mục đích mượn thiết bị: việc công ty hay việc riêng của người mượn.
-- Phiếu PERSONAL cần hai chữ ký (leader rồi admin), xem approval-rules.ts planApprovals().
--
-- Mặc định WORK cho mọi phiếu đã có: chúng được tạo dưới luật một cấp duyệt, gán PERSONAL
-- ngược lại sẽ làm các phiếu đang chờ trong DB kẹt lại đòi thêm chữ ký admin.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MemsBorrowPurpose') THEN
        CREATE TYPE "MemsBorrowPurpose" AS ENUM ('WORK', 'PERSONAL');
    END IF;
END
$$;

ALTER TABLE "mems_borrow_requests"
    ADD COLUMN IF NOT EXISTS "purpose" "MemsBorrowPurpose" NOT NULL DEFAULT 'WORK';
