const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Mocking some internal logic from lark.service.ts
async function main() {
  // Use exact name for Thùy Dung
  const name = Buffer.from('546875cc80792044756e67', 'hex').toString();
  
  const reports = await prisma.larkReport.findMany({
    where: {
      name: { equals: name },
      date: {
        gte: new Date('2026-03-01T00:00:00Z'),
        lte: new Date('2026-03-31T23:59:59Z')
      }
    }
  });

  console.log(`Found ${reports.length} reports for March`);
  
  let totalVideoCount = 0;
  reports.forEach(r => {
    const answers = r.answers || {};
    const key = Object.keys(answers).find(k => k.toLowerCase().includes('50%'));
    const val = answers[key];
    const parsed = Number(val);
    const final = isNaN(parsed) ? 0 : parsed;
    console.log(`Report ID: ${r.id}, Key: "${key}", Value: "${val}", Parsed: ${parsed}, Final: ${final}`);
    totalVideoCount += final;
  });
  
  console.log(`Total Video Count: ${totalVideoCount}`);
}

main().finally(() => prisma.$disconnect());
