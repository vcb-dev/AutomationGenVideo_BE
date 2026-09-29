-- Tiện ích → Tạo ảnh sản phẩm: nhật ký từng lượt (tách nền 0đ / Gemini thay SP trên tay chị Nhạm)
-- để tính chi phí và thống kê ở tab Chi phí — số lượt, số ảnh "Đạt", chi phí cho 1 ảnh đạt.
-- Không lưu ảnh. Không khoá ngoại tới users: xoá người dùng vẫn giữ lịch sử chi phí.

-- CreateTable
CREATE TABLE "product_image_generations" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "mode" VARCHAR(20) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "product_name" VARCHAR(200),
    "model" VARCHAR(100),
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6),
    "cost_note" VARCHAR(300),
    "error_message" VARCHAR(500),
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "approved_at" TIMESTAMP(3),
    "approved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_image_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_image_generations_created_at_idx" ON "product_image_generations"("created_at" DESC);

-- CreateIndex
CREATE INDEX "product_image_generations_mode_created_at_idx" ON "product_image_generations"("mode", "created_at");

-- CreateIndex
CREATE INDEX "product_image_generations_user_id_idx" ON "product_image_generations"("user_id");
