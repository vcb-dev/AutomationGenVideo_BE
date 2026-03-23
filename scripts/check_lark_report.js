const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const reports = await prisma.larkReport.findMany({
        orderBy: {
            created_at: 'desc'
        },
        take: 10
    });
    console.log(JSON.stringify(reports, null, 2));
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
