const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const periods = await prisma.reportPeriod.findMany();
    console.log(`Report Periods:`, periods);
  } catch (err) {
    console.error(`Error:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();
