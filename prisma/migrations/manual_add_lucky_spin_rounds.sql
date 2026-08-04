-- Lượt quay do server bốc: chống can thiệp kết quả từ trình duyệt và cho phép người xem
-- dựng lại đúng vòng quay đang chạy.
-- Viết tay, KHÔNG dùng prisma db push (xem manual_add_lucky_spin.sql).

DO $$ BEGIN
  CREATE TYPE "SpinRoundKind" AS ENUM ('MEMBER', 'TEAM', 'GIFT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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

CREATE INDEX IF NOT EXISTS "spin_rounds_workspace_id_started_at_idx"
  ON "spin_rounds"("workspace_id", "started_at");

DO $$ BEGIN
  ALTER TABLE "spin_rounds" ADD CONSTRAINT "spin_rounds_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "spin_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
