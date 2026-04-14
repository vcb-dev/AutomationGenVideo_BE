import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({
        where: { team: { contains: 'JP1', mode: 'insensitive' } },
        select: { full_name: true, email: true, team: true }
    });
    console.log('JP1 Users in schema User:', users);

    const kpiCount = await prisma.larkKPI.count({
        where: { team: { contains: 'JP1', mode: 'insensitive' } }
    });
    console.log('total KPI for JP1:', kpiCount);

    const kpiSamples = await prisma.larkKPI.findMany({
        where: { team: { contains: 'JP1', mode: 'insensitive' } },
        select: { name: true, team: true, report_date: true },
        take: 5
    });
    console.log('KPI samples:', kpiSamples);
}

main().finally(() => prisma.$disconnect());
