
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function serialize(obj) {
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value, 2
  );
}

async function main() {
  const statuses = await prisma.larkListTask.groupBy({
    by: ['status'],
    _count: {
      status: true
    }
  });
  console.log('ListTask Statuses:', serialize(statuses));

  const sampleTask = await prisma.larkListTask.findFirst({
    where: { status: { not: null } }
  });
  console.log('Sample Task:', serialize(sampleTask));
  
  const kpiCount = await prisma.larkKPI.count();
  console.log('Total KPI records:', kpiCount);
  
  const sampleKpi = await prisma.larkKPI.findFirst({
      where: { completed_month: { gt: 0 } }
  });
  console.log('Sample KPI (with completions):', serialize(sampleKpi));

  const today = new Date();
  today.setHours(0,0,0,0);
  const tasksToday = await prisma.larkListTask.count({
      where: { date: { gte: today } }
  });
  console.log('Tasks with date >= today:', tasksToday);
}

main().catch(console.error).finally(() => prisma.$disconnect());
