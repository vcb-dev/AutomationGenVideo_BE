// Kiểm tra các cột định xoá trên DB server (SERVER_DATABASE_URL)
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const url = process.env.SERVER_DATABASE_URL;
if (!url) throw new Error('Thiếu SERVER_DATABASE_URL');
const prisma = new PrismaClient({ datasources: { db: { url } } });

const checks: { table: string; col: string }[] = [
  { table: 'reported_tasks', col: 'team' },
  { table: 'kpi', col: 'task_creative' },
  { table: 'traffic_reports', col: 'traffic_lemon8' },
  { table: 'traffic_reports', col: 'channel_lemon8' },
  { table: 'traffic_reports', col: 'evidence_lemon8' },
  { table: 'traffic_reports', col: 'traffic_twitter' },
  { table: 'traffic_reports', col: 'channel_twitter' },
  { table: 'traffic_reports', col: 'evidence_twitter' },
];

async function main() {
  for (const c of checks) {
    try {
      const r: { total: bigint; filled: bigint }[] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::bigint AS total, COUNT("${c.col}")::bigint AS filled FROM "${c.table}"`,
      );
      console.log(`${c.table}.${c.col}: ${r[0].filled}/${r[0].total} có dữ liệu`);
    } catch (e: any) {
      console.log(`${c.table}.${c.col}: LỖI - ${e.message?.split('\n')[0]}`);
    }
  }

  // Các bảng Django trên server có dữ liệu không?
  const djangoTables: { table_name: string }[] = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND (table_name LIKE 'django_%' OR table_name LIKE 'auth_%' OR table_name LIKE 'video_management_%')
    ORDER BY table_name
  `);
  console.log(`\nBảng Django/auth/video_management trên server: ${djangoTables.length}`);
  for (const t of djangoTables) {
    const r: { c: bigint }[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::bigint AS c FROM "${t.table_name}"`,
    );
    console.log(`  ${t.table_name}: ${Number(r[0].c)} dòng`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
