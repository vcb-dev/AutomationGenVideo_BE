const { PrismaClient } = require('@prisma/client');

async function main() {
    const prisma = new PrismaClient();
    
    const outstandings = await prisma.ReportOutstanding.findMany({
        take: 10
    });
    
    console.log(JSON.stringify(outstandings, null, 2));
    
    await prisma.$disconnect();
}

main().catch(console.error);
