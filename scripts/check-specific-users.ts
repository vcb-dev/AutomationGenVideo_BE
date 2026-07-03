import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('--- USERS TABLE ---');
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { full_name: { contains: 'Nguyễn Thị Ánh', mode: 'insensitive' } },
          { full_name: { contains: 'Tran Thang', mode: 'insensitive' } }
        ]
      }
    });
    console.log(JSON.stringify(users, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));

    console.log('\n--- KPI TABLE (Recent) ---');
    const kpis = await prisma.kpi.findMany({
      where: {
        OR: [
          { name: { contains: 'Nguyễn Thị Ánh', mode: 'insensitive' } },
          { name: { contains: 'Tran Thang', mode: 'insensitive' } }
        ]
      },
      orderBy: { report_date: 'desc' },
      take: 10
    });
    console.log(JSON.stringify(kpis, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));

    console.log('\n--- CHECKLIST REPORTS TABLE (Recent) ---');
    const reports = await prisma.checklistReport.findMany({
      where: {
        OR: [
          { name: { contains: 'Nguyễn Thị Ánh', mode: 'insensitive' } },
          { name: { contains: 'Tran Thang', mode: 'insensitive' } }
        ]
      },
      orderBy: { date: 'desc' },
      take: 10
    });
    console.log(JSON.stringify(reports, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));

  } finally {
    await prisma.$disconnect();
  }
}

main();
