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
  console.log('Fixing shared users table constraints...');
  
  const queries = [
    'ALTER TABLE "users" ALTER COLUMN "lark_record_id" DROP NOT NULL',
    'ALTER TABLE "users" ALTER COLUMN "raw_data" DROP NOT NULL',
    'ALTER TABLE "users" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP',
    'ALTER TABLE "users" ALTER COLUMN "updated_at" DROP NOT NULL'
  ];

  for (const sql of queries) {
    await runQuery(sql);
  }

  console.log('Finished fixing constraints!');
  await prisma.$disconnect();
}

main().catch(console.error);
