
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const t2Count = await prisma.larkKPI.count({ where: { month: 'T2' } });
    console.log('Total T2 KPI count:', t2Count);

    const allMonths = await prisma.larkKPI.groupBy({
        by: ['month'],
        _count: { _all: true }
    });
    console.log('Months in KPI:', allMonths);

    const requesterEmail = 'nglinh890@gmail.com'; // Sample from my previous check
    const user = await prisma.larkPermission.findFirst({
        where: { email: { equals: requesterEmail, mode: 'insensitive' } }
    });
    console.log('User found:', user);
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
