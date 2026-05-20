import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runQuery(sql: string) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`✅ Success: ${sql}`);
  } catch (error: any) {
    console.log(`⚠️ Warning: ${sql} failed - ${error.message}`);
  }
}

async function main() {
  console.log('Starting user columns migration...');
  
  // 1. Add columns
  const columns = [
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "manager_id" uuid',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "team_leader_id" uuid',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_id" text',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "team" text',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lark_employee_record_id" text',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_id" text',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "image_url" text',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_data" jsonb',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_position" text',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_status" text',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_date" timestamp(3)',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP'
  ];

  for (const col of columns) {
    await runQuery(col);
  }

  // 2. Add Unique Constraints
  const uniques = [
    'ALTER TABLE "users" ADD CONSTRAINT "users_google_id_key" UNIQUE ("google_id")',
    'ALTER TABLE "users" ADD CONSTRAINT "users_lark_employee_record_id_key" UNIQUE ("lark_employee_record_id")',
    'ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_key" UNIQUE ("employee_id")'
  ];

  for (const uniq of uniques) {
    await runQuery(uniq);
  }

  // 3. Add Foreign Keys
  const fkeys = [
    'ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL',
    'ALTER TABLE "users" ADD CONSTRAINT "users_team_leader_id_fkey" FOREIGN KEY ("team_leader_id") REFERENCES "users"("id") ON DELETE SET NULL'
  ];

  for (const fk of fkeys) {
    await runQuery(fk);
  }

  console.log('Finished updating user columns!');
  await prisma.$disconnect();
}

main().catch(console.error);
