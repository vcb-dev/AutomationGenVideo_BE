-- Bật/tắt lớp AI của job khớp video ↔ task ngay trên UI (nút trong cửa sổ Map video) thay cho env
-- TASK_VIDEO_MATCH_AI_MODE — đổi env phải restart BE, và prod trên Railway không ai đặt biến này.
-- Mặc định tắt: AI service chạy qua tunnel từ máy local, chỉ bật khi biết chắc nó đang chạy.
ALTER TABLE "auto_assign_settings" ADD COLUMN IF NOT EXISTS "video_match_ai_enabled" BOOLEAN NOT NULL DEFAULT false;
