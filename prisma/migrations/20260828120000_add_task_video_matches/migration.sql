-- Bảng audit cho job khớp tự động video kênh nội bộ (Facebook/Instagram) với task.
-- Mỗi sáng sau khi kéo video về, job chấm điểm heuristic (hashtag tuyến #A1..#A5 +
-- hashtag đặc thù + kênh->team + thời gian) rồi:
--   - đủ tin cậy  -> gắn link vào tasks.published_links, ghi status = 'MATCHED'
--   - không đủ    -> ghi status = 'UNMATCHED' / 'SKIPPED_AMBIGUOUS' (không gắn)
-- Unique (platform, post_id) để không xét lại cùng một video ở lần chạy sau và để
-- job idempotent khi chạy tay nhiều lần.

CREATE TABLE IF NOT EXISTS "task_video_matches" (
  "id"         TEXT NOT NULL,
  "task_id"    TEXT,
  "platform"   TEXT NOT NULL,
  "post_id"    TEXT NOT NULL,
  "url"        TEXT NOT NULL,
  "score"      INTEGER NOT NULL DEFAULT 0,
  "matched_by" JSONB,
  "status"     TEXT NOT NULL DEFAULT 'MATCHED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_video_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "task_video_matches_platform_post_id_key"
  ON "task_video_matches"("platform", "post_id");

CREATE INDEX IF NOT EXISTS "task_video_matches_task_id_idx"
  ON "task_video_matches"("task_id");

-- Cron đọc "các match gần đây" để log/rà soát; FE (nếu bật) list theo status.
CREATE INDEX IF NOT EXISTS "task_video_matches_status_created_at_idx"
  ON "task_video_matches"("status", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'task_video_matches_task_id_fkey'
  ) THEN
    ALTER TABLE "task_video_matches"
      ADD CONSTRAINT "task_video_matches_task_id_fkey"
      FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
