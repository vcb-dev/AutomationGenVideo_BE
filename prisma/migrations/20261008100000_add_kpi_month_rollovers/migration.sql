-- Mỗi tháng mới hệ thống tự chép KPI mục tiêu (editor_kpis + phân bổ tuyến, content_creator_kpis) của
-- tháng trước cho người chưa được đặt KPI. Bảng này đánh dấu tháng đã chép để chỉ chép 1 lần: không
-- có nó thì KPI leader cố ý xoá/đặt 0 sẽ bị chép lại ở lượt cron/auto-assign kế tiếp.
CREATE TABLE IF NOT EXISTS "kpi_month_rollovers" (
    "month" TEXT NOT NULL,
    "source_month" TEXT NOT NULL,
    "editor_kpis_copied" INTEGER NOT NULL DEFAULT 0,
    "creator_kpis_copied" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_month_rollovers_pkey" PRIMARY KEY ("month")
);

-- Tháng đang chạy lúc triển khai coi như đã xử lý: chép giữa tháng sẽ làm người chưa có KPI bỗng
-- nhận chỉ tiêu cả tháng, auto-assign dồn số ngày còn lại → giao dồn task. Bắt đầu chép từ tháng sau.
INSERT INTO "kpi_month_rollovers" ("month", "source_month", "trigger")
VALUES (
    to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM'),
    to_char((now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - interval '1 month', 'YYYY-MM'),
    'BASELINE'
)
ON CONFLICT ("month") DO NOTHING;
