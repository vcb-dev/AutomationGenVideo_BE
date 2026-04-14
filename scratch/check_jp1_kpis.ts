import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const kpiCounts = await prisma.larkKPI.groupBy({
        by: ['name'],
        where: { team: { contains: 'JP1', mode: 'insensitive' } },
        _count: {
            name: true
        }
    });
    console.log('KPI counts by user in JP1:', kpiCounts);

    const checkOther = await prisma.larkKPI.groupBy({
        by: ['name'],
        where: { name: { in: ['Minh Tuấn', 'BẢO VIỆT', 'Quang Đạt', 'Chung Đỗ'] } },
        _count: {
            name: true
        }
    });
    console.log('Do these names exist anywhere?', checkOther);
}

main().finally(() => prisma.$disconnect());
