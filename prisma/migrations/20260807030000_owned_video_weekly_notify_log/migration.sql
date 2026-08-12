-- Nhật ký gửi báo cáo hiệu suất 7 ngày của video kênh nội bộ về Lark.
-- Xem chú thích model OwnedVideoWeeklyNotifyLog trong schema.prisma để biết vì sao tách bảng
-- riêng thay vì thêm cột cờ vào video_management_ownedvideocontent.

CREATE TABLE IF NOT EXISTS "owned_video_weekly_notify_log" (
    "id"           TEXT         NOT NULL,
    "post_id"      VARCHAR(255) NOT NULL,
    "lark_open_id" VARCHAR(64),
    "trang_thai"   VARCHAR(24)  NOT NULL,
    "so_lan_thu"   INTEGER      NOT NULL DEFAULT 0,
    "loi"          TEXT,
    "sent_at"      TIMESTAMP(3),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owned_video_weekly_notify_log_pkey" PRIMARY KEY ("id")
);

-- Một video chốt đúng một lần, kể cả khi cron chạy lại hay có người bấm gửi tay.
CREATE UNIQUE INDEX IF NOT EXISTS "owned_video_weekly_notify_log_post_id_key"
    ON "owned_video_weekly_notify_log" ("post_id");

-- Truy vấn chọn video lọc theo trang_thai để loại các bản ghi đã chốt.
CREATE INDEX IF NOT EXISTS "owned_video_weekly_notify_log_trang_thai_idx"
    ON "owned_video_weekly_notify_log" ("trang_thai");
