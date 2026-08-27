import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config();

// DIRECT_DATABASE_URL trỏ Postgres local (không chạy trong môi trường agent hiện tại) — dùng
// DATABASE_URL (pooled Supabase, đã xác nhận reachable vì dev server kết nối được) thay thế.
// ADD COLUMN ... IF NOT EXISTS trong file SQL nên chạy lại vô hại nếu lỡ chạy 2 lần.
async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const sql = fs.readFileSync(
    'prisma/migrations/20260825000000_add_content_transform_cost_tracking/migration.sql',
    'utf8',
  );
  console.log('Đang chạy migration.sql qua DATABASE_URL...');
  await prisma.$executeRawUnsafe(sql);
  console.log('OK — đã chạy xong.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
