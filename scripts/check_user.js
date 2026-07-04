const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({
        where: {
            OR: [
                { full_name: { contains: 'Việt', mode: 'insensitive' } },
                { email: { contains: 'viet', mode: 'insensitive' } }
            ]
        }
    });
    console.log("Users:");
    console.log(JSON.stringify(users, null, 2));

    const kpis = await prisma.kpi.findMany({
        where: {
            name: { contains: 'Việt', mode: 'insensitive' }
        },
        take: 3
    });
    console.log("KPIs:");
    console.log(JSON.stringify(kpis.map(k => ({ name: k.name, tag: k.tag, team: k.team })), null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
