const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
    try {
        const kpis = await prisma.larkKPI.findMany({
            where: { month: 'T2' },
            take: 5
        });

        console.log('--- LarkKPI Column Inspection ---');
        kpis.forEach(k => {
            console.log(`Name: ${k.name}`);
            console.log(`  kpi_month (KPI THÁNG): ${k.kpi_month}`);
            console.log(`  completed_month (Hoàn thành Tháng): ${k.completed_month}`);
            console.log(`  kpi_progress_month (Tiến độ KPI tháng): ${k.kpi_progress_month}`);
            // Calculate manual %
            const manualPct = k.kpi_month > 0 ? Math.round((k.completed_month / k.kpi_month) * 100) : 0;
            console.log(`  Manual Calculation: ${manualPct}%`);
            console.log(`  Lark Progress Field (*100): ${Math.round((k.kpi_progress_month || 0) * 100)}%`);
            console.log('---');
        });
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

inspect();
