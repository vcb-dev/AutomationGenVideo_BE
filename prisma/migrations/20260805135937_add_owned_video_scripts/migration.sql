-- Kịch bản của video kênh nội bộ, dùng để chấm điểm PAAST.
--
-- Khoá duy nhất (platform, post_id): mỗi video đúng một kịch bản, cả team dùng chung.
-- KHÔNG khoá theo user — điểm PAAST là thuộc tính của video, không phải của người bấm.
--
-- paast_analysis_id để ON DELETE SET NULL: xoá một bản chấm điểm thì kịch bản vẫn còn
-- nguyên (lấy lại tốn một lượt gọi Graph API), chỉ mất phần điểm.
CREATE TABLE "owned_video_scripts" (
    "id"                TEXT NOT NULL,
    "platform"          VARCHAR(20) NOT NULL,
    "post_id"           VARCHAR(255) NOT NULL,
    "nguon"             VARCHAR(20) NOT NULL,
    "noi_dung"          TEXT NOT NULL,
    "so_ky_tu"          INTEGER NOT NULL,
    "ngon_ngu"          VARCHAR(20) NOT NULL DEFAULT '',
    "paast_analysis_id" TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owned_video_scripts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owned_video_scripts_platform_post_id_key"
    ON "owned_video_scripts"("platform", "post_id");

CREATE INDEX "owned_video_scripts_paast_analysis_id_idx"
    ON "owned_video_scripts"("paast_analysis_id");

ALTER TABLE "owned_video_scripts"
    ADD CONSTRAINT "owned_video_scripts_paast_analysis_id_fkey"
    FOREIGN KEY ("paast_analysis_id") REFERENCES "paast_analysis_histories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
