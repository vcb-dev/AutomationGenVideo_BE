const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    try {
        const kpis = await prisma.larkKPI.findMany();
        console.log('Total KPIs:', kpis.length);

        const summary = {};
        kpis.forEach(k => {
            const m = k.month || 'N/A';
            const date = k.report_date || k.created_at;
            const year = date ? new Date(date).getFullYear() : 'N/A';
            const key = `${m} | ${year}`;
            summary[key] = (summary[key] || 0) + 1;
        });

        console.log('KPI Count by Month and Year:');
        console.table(summary);

        const sample = kpis.slice(0, 5).map(k => ({
            name: k.name,
            month: k.month,
            report_date: k.report_date,
            created_at: k.created_at
        }));
        console.log('Sample Data:', sample);

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

check();
