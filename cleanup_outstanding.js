const { PrismaClient } = require('@prisma/client');

async function main() {
    const prisma = new PrismaClient();
    
    // Find all 'out_' records that have duplicate 'recv' records 
    // Usually these have the same email, category, date
    
    const outstandings = await prisma.ReportOutstanding.findMany({
        where: { id: { startsWith: 'out_' } }
    });
    
    let deletedCount = 0;
    
    for (const out of outstandings) {
        if (!out.email || !out.category || !out.date) continue;
        
        // Find if a recv record exists matching this
        const recvMatch = await prisma.ReportOutstanding.findFirst({
            where: {
                id: { not: { startsWith: 'out_' } },
                email: out.email,
                category: out.category,
                date: out.date
            }
        });
        
        if (recvMatch) {
            await prisma.ReportOutstanding.delete({
                where: { id: out.id }
            });
            deletedCount++;
        }
    }
    
    console.log(`Cleaned up ${deletedCount} duplicate out_ records.`);
    
    // Also, trigger a sync to update all missing statuses
    await prisma.$disconnect();
}

main().catch(console.error);
