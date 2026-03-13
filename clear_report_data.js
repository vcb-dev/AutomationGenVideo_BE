
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearTables() {
  console.log('--- Clearing LarkReport and ReportOutstanding tables ---');
  try {
    const reportCount = await prisma.larkReport.deleteMany({});
    console.log(`[SUCCESS] Deleted ${reportCount.count} records from LarkReport.`);

    const outstandingCount = await prisma.reportOutstanding.deleteMany({});
    console.log(`[SUCCESS] Deleted ${outstandingCount.count} records from ReportOutstanding.`);
  } catch (e) {
    console.error('[FAIL] Error clearing tables:', e.message);
  }
}

clearTables().finally(() => prisma.$disconnect());
