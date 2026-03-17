
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const huyKpi = await prisma.larkKPI.findMany({
    where: { name: { contains: 'Nguyễn Quốc Huy', mode: 'insensitive' } }
  });
  console.log('KPIs for Nguyễn Quốc Huy:', JSON.stringify(huyKpi, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value, 2));
  await prisma.$disconnect();
}

check();
