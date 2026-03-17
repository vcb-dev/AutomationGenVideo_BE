
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const records = await prisma.larkKPI.findMany({
    where: { name: { contains: 'Huy', mode: 'insensitive' } },
    select: { name: true, month: true, kpi_day: true, kpi_month: true }
  });
  console.log(JSON.stringify(records, null, 2));
  await prisma.$disconnect();
}

check();
