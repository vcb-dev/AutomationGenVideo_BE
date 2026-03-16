
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const kpis = await prisma.larkKPI.findMany({
    where: { month: 'T3', name: { contains: 'Toán' } }
  });
  
  kpis.forEach(k => {
    console.log(`- name: ${k.name}, day: ${k.completed_day}, month_done: ${k.completed_month}, kpi_m: ${k.kpi_month}, progress: ${k.kpi_progress_month}, rd: ${k.report_date}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
