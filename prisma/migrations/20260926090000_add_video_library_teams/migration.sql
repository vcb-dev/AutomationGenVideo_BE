-- Bộ Sưu Tập: tab Team chỉ cho team sở hữu video thấy (tab Chung thì ai cũng thấy).
-- Bảng nối video ↔ team: một video có thể thuộc nhiều team.

-- CreateTable
CREATE TABLE "video_library_teams" (
    "video_library_id" TEXT NOT NULL,
    "team_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_library_teams_pkey" PRIMARY KEY ("video_library_id","team_id")
);

-- CreateIndex
CREATE INDEX "video_library_teams_team_id_idx" ON "video_library_teams"("team_id");

-- AddForeignKey
ALTER TABLE "video_library_teams" ADD CONSTRAINT "video_library_teams_video_library_id_fkey" FOREIGN KEY ("video_library_id") REFERENCES "video_library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_library_teams" ADD CONSTRAINT "video_library_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: video tab Team đã có gắn vào các team mà người thêm/duyệt (leader) đang lãnh đạo
-- hoặc là thành viên. Không xác định được team thì video chỉ còn hiện ở tab Chung.
-- added_by_id là TEXT còn teams/team_members dùng UUID → so sánh qua ::text.
INSERT INTO "video_library_teams" ("video_library_id", "team_id")
SELECT vl."id", t."id"
FROM "video_library" vl
JOIN "teams" t ON t."leader_id"::text = vl."added_by_id"
WHERE vl."collection_type" = 'TEAM'
UNION
SELECT vl."id", tm."team_id"
FROM "video_library" vl
JOIN "team_members" tm ON tm."user_id"::text = vl."added_by_id"
WHERE vl."collection_type" = 'TEAM'
ON CONFLICT DO NOTHING;
