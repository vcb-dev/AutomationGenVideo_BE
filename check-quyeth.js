const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    try {
        const ks = await prisma.larkKPI.findMany({
            where: {
                name: { contains: 'Bùi Minh Quyết', mode: 'insensitive' },
                month: 'T2'
            }
        });
        console.log('RECORDS FOUND:', ks.length);
        ks.forEach(k => {
            console.log(`ID: ${k.id}`);
            console.log(`  Name: ${k.name}`);
            console.log(`  Target: ${k.kpi_month}`);
            console.log(`  Done: ${k.completed_month}`);
            console.log(`  Progress: ${k.kpi_progress_month}`);
            console.log(`  Revenue: ${k.revenue_month}`);
            console.log(`  Date: ${k.report_date}`);
            console.log('---');
        });
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

check();
