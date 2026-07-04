import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.SERVER_DATABASE_URL } },
});

async function main() {
  const tables: { table_name: string }[] = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name IN ('reported_tasks', 'kpi', 'traffic_reports', 'users', 'checklist_reports')
  `);
  console.log('Bảng tồn tại:', tables.map((t) => t.table_name).join(', ') || '(không có)');

  try {
    const r: { total: bigint; filled: bigint }[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::bigint AS total, COUNT("team")::bigint AS filled FROM "reported_tasks"`,
    );
    console.log('reported_tasks.team:', r[0]);
  } catch (e) {
    console.error('Lỗi chi tiết:', e);
  }
}

main().finally(() => prisma.$disconnect());
