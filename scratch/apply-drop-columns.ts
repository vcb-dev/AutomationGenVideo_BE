import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config();

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
  const sql = fs.readFileSync('prisma/migrations/20260720120000_drop_unused_user_hr_columns/migration.sql', 'utf8');
  console.log('Đang chạy migration.sql qua direct connection...');
  await prisma.$executeRawUnsafe(sql);
  console.log('OK — đã chạy xong.');
  await prisma.$disconnect();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
