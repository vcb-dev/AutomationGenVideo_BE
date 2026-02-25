const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
    try {
        const kpis = await prisma.larkKPI.findMany({
            where: { month: 'T2' },
            take: 10
        });

        console.log('Sample KPI Data:');
        kpis.forEach(k => {
            const calculated = k.kpi_month > 0 ? (k.completed_month / k.kpi_month) : 0;
            console.log(`Name: ${k.name}`);
            console.log(`  Completed: ${k.completed_month}`);
            console.log(`  Target: ${k.kpi_month}`);
            console.log(`  Lark Progress: ${k.kpi_progress_month}`);
            console.log(`  Calculated (C/T): ${calculated}`);
            console.log('---');
        });
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

inspect();
