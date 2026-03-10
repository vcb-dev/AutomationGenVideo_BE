
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const minMaxDate = await prisma.$queryRaw`SELECT MIN(date) as min_date, MAX(date) as max_date FROM lark_reports;`;
    const countMarch = await prisma.larkReport.count({
      where: {
        date: {
          gte: new Date('2026-03-01'),
          lte: new Date('2026-03-31')
        }
      }
    });
    
    console.log('Date range in LarkReport:', minMaxDate);
    console.log('Count for March 2026:', countMarch);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
