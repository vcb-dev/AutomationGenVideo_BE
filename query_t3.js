
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const kpis = await prisma.larkKPI.findMany({
    where: { month: { in: ['T3', 'T03', '3'] } },
    take: 10
  });
  console.log(JSON.stringify(kpis, (k,v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
