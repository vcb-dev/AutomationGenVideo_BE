import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('--- SEARCHING FOR THANG/THẮNG IN USERS ---');
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { full_name: { contains: 'Thắng', mode: 'insensitive' } },
          { full_name: { contains: 'Thang', mode: 'insensitive' } },
          { email: { contains: 'thang', mode: 'insensitive' } }
        ]
      }
    });
    console.log(JSON.stringify(users, null, 2));

    console.log('\n--- SEARCHING FOR THANG/THẮNG IN KPI ---');
    const kpis = await prisma.kpi.findMany({
      where: {
        OR: [
          { name: { contains: 'Thắng', mode: 'insensitive' } },
          { name: { contains: 'Thang', mode: 'insensitive' } }
        ]
      },
      orderBy: { report_date: 'desc' },
      take: 10
    });
    console.log(JSON.stringify(kpis, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main();
