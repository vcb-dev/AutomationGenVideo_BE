const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.larkReport.deleteMany({});
  console.log('Cleared lark_reports');
  await prisma.$queryRawUnsafe('DELETE FROM report_outstanding;');
  console.log('Cleared report_outstanding');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
