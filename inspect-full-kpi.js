const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
    try {
        const kpi = await prisma.larkKPI.findFirst({
            where: { month: 'T2', name: { contains: 'Linh', mode: 'insensitive' } }
        });

        console.log('Full KPI Data for Linh:');
        console.log(JSON.stringify(kpi, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

inspect();
