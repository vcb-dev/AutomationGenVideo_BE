const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    try {
        const ks = await prisma.larkKPI.findMany({
            where: {
                name: { contains: 'Bùi Minh Quyết', mode: 'insensitive' }
            }
        });
        console.log('ALL RECORDS FOUND:', ks.length);
        ks.forEach(k => {
            console.log(`ID: ${k.id} | Month: ${k.month} | Target: ${k.kpi_month} | Done: ${k.completed_month} | Progress: ${k.kpi_progress_month} | Revenue: ${k.revenue_month} | Date: ${k.report_date}`);
        });
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

check();
