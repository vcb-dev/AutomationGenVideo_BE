import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('--- SEARCHING FOR TRAN THANG IN KPI ---');
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
    
    // safe serialization of BigInt
    const safeKpis = kpis.map(kpi => ({
      ...kpi,
      revenue_month: kpi.revenue_month?.toString(),
      traffic_month: kpi.traffic_month?.toString()
    }));
    
    console.log(JSON.stringify(safeKpis, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main();
