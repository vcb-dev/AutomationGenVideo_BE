-- Thêm cột lưu kết quả chấm điểm kịch bản (7 nhóm/23 tiêu chí + Hard Gate) theo
-- Content Creator & Editor Playbook (BDC-VCB) mục 21.1 và 22.
ALTER TABLE "content_transform_histories" ADD COLUMN IF NOT EXISTS "score_result" JSONB;
ALTER TABLE "content_transform_histories" ADD COLUMN IF NOT EXISTS "overall_score" INTEGER;
