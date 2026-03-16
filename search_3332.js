const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const traffics = await prisma.larkTraffic.findMany({
    where: {
      OR: [
        { traffic: { equals: 3332 } },
        { total_traffic: { equals: 3332 } }
      ]
    }
  });
  console.log('Traffics:', JSON.stringify(traffics, null, 2));

  const reports = await prisma.larkReport.findMany();
  const reportsWith3332 = reports.filter(r => JSON.stringify(r.answers).includes("3332"));
  console.log('Reports with 3332:', reportsWith3332.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
