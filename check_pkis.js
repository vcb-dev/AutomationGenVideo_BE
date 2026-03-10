
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const reportKpiCount = await prisma.larkReportKPI.count();
    const kpiCount = await prisma.larkKPI.count();
    
    console.log(`LarkReportKPI Count: ${reportKpiCount}`);
    console.log(`LarkKPI Count: ${kpiCount}`);
  } catch (e) {
    console.error('Check failed:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
