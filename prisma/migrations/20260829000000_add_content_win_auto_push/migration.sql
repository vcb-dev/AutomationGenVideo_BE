-- Luồng "content win -> tự đẩy về kho tổng" (task-auto/tasks/content-win-auto-push.service.ts):
-- khi 1 task APPROVED đạt content-win (>=1 link bài đăng bất kỳ > ngưỡng 10.000 view), hệ thống
-- tự đưa content của task đó vào kho tổng (Content + ContentWarehouse tháng hiện tại), gắn nhãn
-- "Content Win", và lưu lại link video có view cao nhất.
--
--  * tasks.content_win_pushed_at  — đánh dấu task đã đẩy để cron sáng (refreshMonthlyPublishedLinkStats)
--                                    + nút "Cập nhật" thống kê không đẩy lại lần sau.
--  * contents.win_video_url/views/platform + won_at — link + số view thắng, set 1 lần, không đổi về sau.
--  * contents.source_editor_content_id — mirror source_team_content_id: khi task chỉ có content ở
--    kho cá nhân (chưa lên kho team), Content mới tạo trỏ về EditorContent gốc, unique để cùng 1
--    editor content thắng ở nhiều task không sinh ra Content trùng ở kho tổng.

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "content_win_pushed_at" TIMESTAMP(3);

ALTER TABLE "contents" ADD COLUMN IF NOT EXISTS "source_editor_content_id" TEXT;
ALTER TABLE "contents" ADD COLUMN IF NOT EXISTS "win_video_url" TEXT;
ALTER TABLE "contents" ADD COLUMN IF NOT EXISTS "win_video_views" BIGINT;
ALTER TABLE "contents" ADD COLUMN IF NOT EXISTS "win_video_platform" TEXT;
ALTER TABLE "contents" ADD COLUMN IF NOT EXISTS "won_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "contents_source_editor_content_id_key"
  ON "contents"("source_editor_content_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'contents_source_editor_content_id_fkey'
  ) THEN
    ALTER TABLE "contents"
      ADD CONSTRAINT "contents_source_editor_content_id_fkey"
      FOREIGN KEY ("source_editor_content_id") REFERENCES "editor_contents"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
