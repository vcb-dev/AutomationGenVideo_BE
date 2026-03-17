
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const records = await prisma.larkKPI.findMany({
    where: { 
      OR: [
        { name: { contains: 'Thùy Trang', mode: 'insensitive' } },
        { name: { contains: 'Thuỳ Trang', mode: 'insensitive' } }
      ]
    },
    select: { id: true, name: true, month: true, kpi_day: true, kpi_month: true, report_date: true, team: true }
  });
  console.log('KPI Records for Thùy Trang:');
  console.log(JSON.stringify(records, null, 2));
  await prisma.$disconnect();
}

check();
