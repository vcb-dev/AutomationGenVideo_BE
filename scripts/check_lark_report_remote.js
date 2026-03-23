const { PrismaClient } = require('@prisma/client');

// Connect to remote database
const prisma = new PrismaClient({
    datasources: {
        db: {
            url: "postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?schema=public"
        }
    }
});

async function main() {
    console.log('Connecting to remote DB...');
    const reports = await prisma.larkReport.findMany({
        where: {
            OR: [
                { name: { contains: 'Bảo Việt', mode: 'insensitive' } },
                { email: { contains: 'viet', mode: 'insensitive' } }
            ]
        },
        orderBy: {
            created_at: 'desc'
        },
        take: 5
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
