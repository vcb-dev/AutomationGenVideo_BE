import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

// Prisma's $executeRawUnsafe uses a prepared statement per call — cannot run a whole
// multi-statement .sql file in one shot. Split into individual statements here instead.
const STATEMENTS = [
  `ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "updated_by" TEXT;`,
  `DO $$
BEGIN
  ALTER TABLE "characters" ADD CONSTRAINT "characters_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `CREATE TABLE IF NOT EXISTS "character_system_prompt_history" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "old_content" TEXT NOT NULL,
    "changed_by" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_system_prompt_history_pkey" PRIMARY KEY ("id")
  );`,
  `CREATE INDEX IF NOT EXISTS "character_system_prompt_history_character_id_idx" ON "character_system_prompt_history"("character_id");`,
  `CREATE INDEX IF NOT EXISTS "character_system_prompt_history_changed_at_idx" ON "character_system_prompt_history"("changed_at");`,
  `DO $$
BEGIN
  ALTER TABLE "character_system_prompt_history" ADD CONSTRAINT "character_system_prompt_history_character_id_fkey"
    FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$
BEGIN
  ALTER TABLE "character_system_prompt_history" ADD CONSTRAINT "character_system_prompt_history_changed_by_fkey"
    FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
];

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });

  for (let i = 0; i < STATEMENTS.length; i++) {
    console.log(`[${i + 1}/${STATEMENTS.length}] Executing...`);
    await prisma.$executeRawUnsafe(STATEMENTS[i]);
    console.log(`   ✓ done`);
  }

  const cols: any = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'characters' AND column_name = 'updated_by';`,
  );
  console.log('characters.updated_by:', cols);

  const tbl: any = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'character_system_prompt_history' ORDER BY ordinal_position;`,
  );
  console.log('character_system_prompt_history columns:', tbl);

  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
