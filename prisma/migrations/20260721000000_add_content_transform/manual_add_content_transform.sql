-- Tạo bảng cho tính năng Content Transform (chuyển đổi kịch bản bằng AI, nhánh baoviet)
-- đã có trong schema.prisma nhưng CHƯA từng có migration nào tạo bảng thật trên DB —
-- xác nhận trực tiếp trên DB thật: chỉ push_subscriptions tồn tại, characters và
-- content_transform_histories đều chưa có. Không có migration này thì mọi endpoint
-- /content-transform/* sẽ lỗi P2021 "relation does not exist".

-- CreateEnum
CREATE TYPE "TransformStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "InputType" AS ENUM ('TEXT', 'VIDEO', 'AUDIO');

-- CreateTable
CREATE TABLE "characters" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "avatar_url" TEXT,
    "system_prompt" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_transform_histories" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "character_id" TEXT NOT NULL,
    "input_text" TEXT NOT NULL,
    "output_text" TEXT,
    "status" "TransformStatus" NOT NULL DEFAULT 'PENDING',
    "input_type" "InputType" NOT NULL DEFAULT 'TEXT',
    "error_message" TEXT,
    "model_used" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_transform_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "characters_name_key" ON "characters"("name");

-- CreateIndex
CREATE UNIQUE INDEX "characters_slug_key" ON "characters"("slug");

-- CreateIndex
CREATE INDEX "characters_is_active_idx" ON "characters"("is_active");

-- CreateIndex
CREATE INDEX "characters_order_index_idx" ON "characters"("order_index");

-- CreateIndex
CREATE INDEX "content_transform_histories_user_id_idx" ON "content_transform_histories"("user_id");

-- CreateIndex
CREATE INDEX "content_transform_histories_character_id_idx" ON "content_transform_histories"("character_id");

-- CreateIndex
CREATE INDEX "content_transform_histories_status_idx" ON "content_transform_histories"("status");

-- CreateIndex
CREATE INDEX "content_transform_histories_created_at_idx" ON "content_transform_histories"("created_at");

-- CreateIndex
CREATE INDEX "content_transform_histories_user_id_created_at_idx" ON "content_transform_histories"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "content_transform_histories" ADD CONSTRAINT "content_transform_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_transform_histories" ADD CONSTRAINT "content_transform_histories_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
