import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const cols: { column_name: string }[] = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'traffic_reports'
      AND (column_name LIKE '%lemon8%' OR column_name LIKE '%twitter%')
  `);
  console.log('Cột lemon8/twitter còn lại:', cols.length ? cols : '(đã xoá hết)');

  const tables: { c: bigint }[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::bigint AS c FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND (table_name LIKE 'django_%' OR table_name LIKE 'auth_%'
           OR (table_name LIKE 'video_management_%' AND table_name <> 'video_management_voice'))
  `);
  console.log('Bảng Django còn lại:', Number(tables[0].c));

  const totalTables: { c: bigint }[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::bigint AS c FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  console.log('Tổng số bảng hiện tại:', Number(totalTables[0].c));

  const junk: { c: bigint }[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS c FROM users WHERE email = '' OR full_name = ''`,
  );
  console.log('User rác còn lại:', Number(junk[0].c));

  // Sanity: đọc thử traffic_reports bằng Prisma client mới
  const count = await prisma.trafficReport.count();
  console.log('trafficReport.count() OK:', count);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
