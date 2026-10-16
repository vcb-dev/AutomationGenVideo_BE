-- Khám phá Video: nhật ký chi phí API bên thứ ba (TikHub, Gemini) của mọi lượt BE gọi AI service,
-- để thống kê và kiểm soát chi phí theo trang / nền tảng / người thao tác.
-- Không khoá ngoại: xoá video/content/người dùng vẫn giữ lịch sử chi phí.

-- CreateTable
CREATE TABLE "api_usage_logs" (
    "id" TEXT NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "feature" VARCHAR(40) NOT NULL,
    "page" VARCHAR(30) NOT NULL DEFAULT 'OTHER',
    "endpoint" VARCHAR(200) NOT NULL,
    "platform" VARCHAR(20),
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "http_status" INTEGER,
    "calls" INTEGER NOT NULL DEFAULT 1,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "user_id" UUID,
    "video_id" VARCHAR(255),
    "approved_content_id" TEXT,
    "ai_path" VARCHAR(200),
    "request_route" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_usage_logs_created_at_idx" ON "api_usage_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "api_usage_logs_provider_created_at_idx" ON "api_usage_logs"("provider", "created_at");

-- CreateIndex
CREATE INDEX "api_usage_logs_page_created_at_idx" ON "api_usage_logs"("page", "created_at");
