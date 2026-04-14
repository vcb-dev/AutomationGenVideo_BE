import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const kpis = await prisma.larkKPI.findMany({
        where: { name: 'Chung Đỗ ' },
        select: { name: true, report_date: true },
        orderBy: { report_date: 'desc' }
    });
    console.log('Chung Do kpis:', kpis);
}

main().finally(() => prisma.$disconnect());
