
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    try {
        const kpis = await prisma.larkKPI.findMany({
            where: { name: { contains: 'Dung', mode: 'insensitive' } }
        });
        console.log('Dung KPIs:', kpis.map(k => ({ name: k.name, month: k.month, team: k.team })));

        const perms = await prisma.$queryRawUnsafe('SELECT * FROM lark_permissions WHERE name ILIKE \'%Dung%\'');
        console.log('Dung Permissions:', perms);

        const allPermsCount = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM lark_permissions');
        console.log('Total Permissions:', allPermsCount);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

check();
