import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helper to stringify BigInt
const stringify = (obj: any) => {
  return JSON.stringify(obj, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value, 
    2
  );
};

async function main() {
  console.log('=== LARK KPI RECORDS FOR "TUAN ANH" ===');
  const kpis = await prisma.larkKPI.findMany({
    where: {
      OR: [
        { name: { contains: 'tuan anh', mode: 'insensitive' } },
        { name: { contains: 'tuấn anh', mode: 'insensitive' } },
      ]
    }
  });
  console.log(stringify(kpis));

  console.log('\n=== LARK REPORTS FOR "TUAN ANH" ===');
  const reports = await prisma.larkReport.findMany({
    where: {
      OR: [
        { name: { contains: 'tuan anh', mode: 'insensitive' } },
        { name: { contains: 'tuấn anh', mode: 'insensitive' } },
      ]
    },
    orderBy: { date: 'desc' },
    take: 10
  });
  console.log(stringify(reports));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
