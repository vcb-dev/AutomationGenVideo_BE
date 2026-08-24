-- Task-auto module index review: cân bằng lại giữa tốc độ ghi (INSERT/UPDATE hàng loạt của
-- auto-assign cron + mọi status transition trên Task) và tốc độ đọc (dashboard/report/approval
-- queue). Chi tiết lý do từng index nằm ở comment cạnh @@index tương ứng trong schema.prisma.

-- ── Bỏ index không còn được bất kỳ query nào dùng (xác nhận bằng grep toàn backend) ──

-- tasks.run_id: chỉ được ghi lúc tạo task (auto-assign), chưa từng có query lọc theo cột này;
-- quan hệ AssignmentRun.tasks cũng không được include ở đâu.
DROP INDEX IF EXISTS "tasks_run_id_idx";

-- task_assignments: cả bảng chỉ được ghi (create/createMany) từ task-creator.ts, đọc duy nhất
-- qua include theo task_id (Task.findOne) — user_id/run_id chưa từng bị lọc trực tiếp.
DROP INDEX IF EXISTS "task_assignments_run_id_idx";
DROP INDEX IF EXISTS "task_assignments_user_id_assigned_at_idx";

-- content_translations: @@unique([content_id, market]) đã bao hàm mọi query lọc riêng
-- content_id qua leftmost-prefix — index đơn cột này trùng lặp hoàn toàn.
DROP INDEX IF EXISTS "content_translations_content_id_idx";

-- ── Thêm index cho các truy vấn nóng hiện chưa được hỗ trợ ──

-- Đếm "quá hạn"/"đến hạn hôm nay" (live, không theo bộ lọc ngày) ở global/personal/leader
-- dashboard — trước đây tasks không có index nào chứa deadline, mỗi lần load dashboard phải
-- quét toàn bảng.
CREATE INDEX IF NOT EXISTS "tasks_deadline_status_idx" ON "tasks"("deadline", "status");

-- status=APPROVED + reviewed_at range lặp lại ở nhiều hàm dashboard/report (monthlyApproved,
-- approved-in-period, getVideoByContentLine, getProductVideoStats).
CREATE INDEX IF NOT EXISTS "tasks_status_reviewed_at_idx" ON "tasks"("status", "reviewed_at");

-- Lọc theo tháng ở findAll, nhánh fallback "deadline null → theo created_at" (~8 nơi), và cron
-- refreshMonthlyPublishedLinkStats (quét cả tháng, trước đây không có index nào hỗ trợ).
CREATE INDEX IF NOT EXISTS "tasks_created_at_idx" ON "tasks"("created_at");

-- editor_approvals trước đây không có bất kỳ index nào — count(status=APPROVED)/
-- count(status=PENDING) bị quét full table trên mỗi lần load global dashboard.
CREATE INDEX IF NOT EXISTS "editor_approvals_status_created_at_idx" ON "editor_approvals"("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "editor_approvals_user_id_idx" ON "editor_approvals"("user_id");

-- Danh sách "chờ duyệt" (content-approval.service.ts list()) lọc theo status, không theo
-- task_id — index [task_id, created_at] có sẵn không phục vụ được truy vấn này.
CREATE INDEX IF NOT EXISTS "task_content_approvals_status_created_at_idx" ON "task_content_approvals"("status", "created_at" DESC);

-- Mirror content_creator_daily_kpis.@@index([date]) — kpi.service.ts getEditorDailyKpis() cho
-- phép lọc chỉ theo date/from-to, không bắt buộc team_id (admin xem toàn hệ thống theo ngày).
CREATE INDEX IF NOT EXISTS "editor_daily_kpis_date_idx" ON "editor_daily_kpis"("date");

-- contents/sources (kho tổng): mọi filter ở findAllContents/findAllSources đều optional,
-- orderBy mặc định created_at desc — mirror products.@@index([priority_score desc]) đã có sẵn.
CREATE INDEX IF NOT EXISTS "contents_created_at_idx" ON "contents"("created_at");
CREATE INDEX IF NOT EXISTS "sources_created_at_idx" ON "sources"("created_at");
