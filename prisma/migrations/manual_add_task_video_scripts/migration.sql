-- CreateTable
CREATE TABLE "task_video_scripts" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hashtags" TEXT[],
    "translation" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_video_scripts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_video_scripts_task_id_key" ON "task_video_scripts"("task_id");

-- AddForeignKey
ALTER TABLE "task_video_scripts" ADD CONSTRAINT "task_video_scripts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
