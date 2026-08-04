-- Vòng quay may mắn: bảng dùng chung toàn công ty cho sự kiện nội bộ.

-- Viết tay vì `prisma migrate dev` không chạy được (xem MIGRATION_DEBT.md) và

-- `prisma db push` sẽ xoá ~60 bảng đang có thật trong DB nhưng thiếu trong schema.



-- CreateEnum
CREATE TYPE "SpinEntryStatus" AS ENUM ('ACTIVE', 'DONE');

-- CreateTable
CREATE TABLE "spin_workspaces" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spin_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spin_teams" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SpinEntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "gift_received" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spin_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spin_members" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "team_id" TEXT,
    "name" TEXT NOT NULL,
    "status" "SpinEntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "gift_received" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spin_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spin_gifts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spin_gifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spin_member_wins" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "member_id" TEXT,
    "member_name" TEXT NOT NULL,
    "team_name" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spin_member_wins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spin_team_wins" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "team_id" TEXT,
    "team_name" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spin_team_wins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spin_gift_awards" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "member_id" TEXT,
    "team_id" TEXT,
    "gift_id" TEXT,
    "recipient_name" TEXT NOT NULL,
    "team_name" TEXT NOT NULL,
    "gift_name" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spin_gift_awards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spin_workspaces_slug_key" ON "spin_workspaces"("slug");

-- CreateIndex
CREATE INDEX "spin_teams_workspace_id_idx" ON "spin_teams"("workspace_id");

-- CreateIndex
CREATE INDEX "spin_members_workspace_id_idx" ON "spin_members"("workspace_id");

-- CreateIndex
CREATE INDEX "spin_members_team_id_idx" ON "spin_members"("team_id");

-- CreateIndex
CREATE INDEX "spin_gifts_workspace_id_idx" ON "spin_gifts"("workspace_id");

-- CreateIndex
CREATE INDEX "spin_member_wins_workspace_id_created_at_idx" ON "spin_member_wins"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "spin_member_wins_member_id_idx" ON "spin_member_wins"("member_id");

-- CreateIndex
CREATE INDEX "spin_team_wins_workspace_id_created_at_idx" ON "spin_team_wins"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "spin_gift_awards_workspace_id_created_at_idx" ON "spin_gift_awards"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "spin_gift_awards_member_id_idx" ON "spin_gift_awards"("member_id");

-- AddForeignKey
ALTER TABLE "spin_teams" ADD CONSTRAINT "spin_teams_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_members" ADD CONSTRAINT "spin_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_members" ADD CONSTRAINT "spin_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "spin_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_gifts" ADD CONSTRAINT "spin_gifts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_member_wins" ADD CONSTRAINT "spin_member_wins_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_member_wins" ADD CONSTRAINT "spin_member_wins_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "spin_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_team_wins" ADD CONSTRAINT "spin_team_wins_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_team_wins" ADD CONSTRAINT "spin_team_wins_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "spin_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_gift_awards" ADD CONSTRAINT "spin_gift_awards_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_gift_awards" ADD CONSTRAINT "spin_gift_awards_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "spin_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_gift_awards" ADD CONSTRAINT "spin_gift_awards_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "spin_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_gift_awards" ADD CONSTRAINT "spin_gift_awards_gift_id_fkey" FOREIGN KEY ("gift_id") REFERENCES "spin_gifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
