import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const teams = await prisma.larkKPI.groupBy({
        by: ['team'],
        _count: {
            _all: true
        },
        _sum: {
            completed_month: true,
            traffic_month: true,
            revenue_month: true
        }
    });

    console.log(JSON.stringify(teams, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    , 2));
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
