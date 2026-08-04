-- PaastAnalysisHistory: lịch sử mỗi lần phân tích/nâng cấp content theo khung PAAST.
-- upgraded_from_id tự tham chiếu bảng này để nối bản gốc -> bản đã nâng cấp.

CREATE TABLE "paast_analysis_histories" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "input_text" TEXT NOT NULL,
    "status" "TransformStatus" NOT NULL DEFAULT 'PENDING',
    "analysis_result" JSONB,
    "total_score" INTEGER,
    "error_message" TEXT,
    "model_used" TEXT,
    "duration_ms" INTEGER,
    "upgraded_from_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paast_analysis_histories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "paast_analysis_histories_user_id_idx" ON "paast_analysis_histories"("user_id");

CREATE INDEX "paast_analysis_histories_status_idx" ON "paast_analysis_histories"("status");

ALTER TABLE "paast_analysis_histories" ADD CONSTRAINT "paast_analysis_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "paast_analysis_histories" ADD CONSTRAINT "paast_analysis_histories_upgraded_from_id_fkey" FOREIGN KEY ("upgraded_from_id") REFERENCES "paast_analysis_histories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
