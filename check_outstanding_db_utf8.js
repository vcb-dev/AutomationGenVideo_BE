const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

async function main() {
    const prisma = new PrismaClient();
    
    const outstandings = await prisma.ReportOutstanding.findMany({
        take: 10
    });
    
    fs.writeFileSync('db_out_utf8.json', JSON.stringify(outstandings, null, 2), 'utf8');
    
    await prisma.$disconnect();
}

main().catch(console.error);
