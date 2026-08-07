-- Vòng quay may mắn: bảng dùng chung toàn công ty cho sự kiện nội bộ.
--
-- Gộp nguyên vẹn ba file viết tay trước đó (manual_add_lucky_spin.sql, _rounds.sql, _control.sql).
-- Chúng nằm PHẲNG trong prisma/migrations/ nên `prisma migrate deploy` — lệnh duy nhất mà
-- .github/workflows/deploy-railway.yml chạy — lướt qua, vì migrate chỉ đọc thư mục con có
-- migration.sql. Hậu quả đã xảy ra thật: code lucky-spin lên production ngày 2026-08-05 mà
-- bảng thì không, mọi request GET /lucky-spin/:workspace/state trả 500 cho tới khi chạy tay.
--
-- TOÀN BỘ file này phải idempotent: lúc thêm vào repo thì cả DB local lẫn production ĐỀU ĐÃ CÓ
-- các bảng này (tạo tay), nhưng migration lại chưa nằm trong _prisma_migrations — nên lần deploy
-- kế tiếp Prisma vẫn chạy nó một lần. Không idempotent thì `CREATE TABLE` gặp bảng cũ sẽ ném lỗi
-- và đánh sập cả pipeline deploy.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SpinEntryStatus" AS ENUM ('ACTIVE', 'DONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SpinRoundKind" AS ENUM ('MEMBER', 'TEAM', 'GIFT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "spin_workspaces" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spin_workspaces_pkey" PRIMARY KEY ("id")
);

-- Khóa điều khiển: ai đang cầm quyền quay, hết hạn lúc nào. Cột rời vì thêm sau khi bảng
-- đã chạy thật ở local — giữ nguyên dạng ADD COLUMN để môi trường cũ nâng cấp được.
ALTER TABLE "spin_workspaces" ADD COLUMN IF NOT EXISTS "controller_id" UUID;
ALTER TABLE "spin_workspaces" ADD COLUMN IF NOT EXISTS "controller_name" TEXT;
ALTER TABLE "spin_workspaces" ADD COLUMN IF NOT EXISTS "control_expires_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "spin_teams" (
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
CREATE TABLE IF NOT EXISTS "spin_members" (
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
CREATE TABLE IF NOT EXISTS "spin_gifts" (
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
CREATE TABLE IF NOT EXISTS "spin_member_wins" (
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
CREATE TABLE IF NOT EXISTS "spin_team_wins" (
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
CREATE TABLE IF NOT EXISTS "spin_gift_awards" (
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

-- Lượt quay do server bốc: chống can thiệp kết quả từ trình duyệt và cho phép người xem
-- dựng lại đúng vòng quay đang chạy.
CREATE TABLE IF NOT EXISTS "spin_rounds" (
    "id"              TEXT NOT NULL,
    "workspace_id"    TEXT NOT NULL,
    "kind"            "SpinRoundKind" NOT NULL,
    "pool_ids"        TEXT[],
    "pool_names"      TEXT[],
    "winner_indexes"  INTEGER[],
    "recipient_id"    TEXT,
    "recipient_type"  TEXT,
    "started_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at"      TIMESTAMP(3),
    "created_by_id"   UUID,
    "created_by_name" TEXT,

    CONSTRAINT "spin_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "spin_workspaces_slug_key" ON "spin_workspaces"("slug");
CREATE INDEX IF NOT EXISTS "spin_teams_workspace_id_idx" ON "spin_teams"("workspace_id");
CREATE INDEX IF NOT EXISTS "spin_members_workspace_id_idx" ON "spin_members"("workspace_id");
CREATE INDEX IF NOT EXISTS "spin_members_team_id_idx" ON "spin_members"("team_id");
CREATE INDEX IF NOT EXISTS "spin_gifts_workspace_id_idx" ON "spin_gifts"("workspace_id");
CREATE INDEX IF NOT EXISTS "spin_member_wins_workspace_id_created_at_idx" ON "spin_member_wins"("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "spin_member_wins_member_id_idx" ON "spin_member_wins"("member_id");
CREATE INDEX IF NOT EXISTS "spin_team_wins_workspace_id_created_at_idx" ON "spin_team_wins"("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "spin_gift_awards_workspace_id_created_at_idx" ON "spin_gift_awards"("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "spin_gift_awards_member_id_idx" ON "spin_gift_awards"("member_id");
CREATE INDEX IF NOT EXISTS "spin_rounds_workspace_id_started_at_idx" ON "spin_rounds"("workspace_id", "started_at");

-- AddForeignKey
-- Postgres không có `ADD CONSTRAINT IF NOT EXISTS`, nên bọc DO/EXCEPTION để chạy lại không sập.
DO $$ BEGIN
  ALTER TABLE "spin_teams" ADD CONSTRAINT "spin_teams_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "spin_members" ADD CONSTRAINT "spin_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "spin_members" ADD CONSTRAINT "spin_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "spin_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "spin_gifts" ADD CONSTRAINT "spin_gifts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "spin_member_wins" ADD CONSTRAINT "spin_member_wins_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "spin_member_wins" ADD CONSTRAINT "spin_member_wins_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "spin_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "spin_team_wins" ADD CONSTRAINT "spin_team_wins_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "spin_team_wins" ADD CONSTRAINT "spin_team_wins_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "spin_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "spin_gift_awards" ADD CONSTRAINT "spin_gift_awards_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "spin_gift_awards" ADD CONSTRAINT "spin_gift_awards_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "spin_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "spin_gift_awards" ADD CONSTRAINT "spin_gift_awards_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "spin_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "spin_gift_awards" ADD CONSTRAINT "spin_gift_awards_gift_id_fkey" FOREIGN KEY ("gift_id") REFERENCES "spin_gifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "spin_rounds" ADD CONSTRAINT "spin_rounds_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
