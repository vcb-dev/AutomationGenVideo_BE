const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const report = await prisma.larkReport.findUnique({
    where: { id: 'local_1e471e84405f' }
  });
  const key = Object.keys(report.answers).find(k => k.includes('50%'));
  console.log(`Key: "${key}"`);
  console.log(`Value: "${report.answers[key]}"`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
