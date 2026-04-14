import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const samples = await prisma.larkKPI.findMany({
        take: 10,
        orderBy: { report_date: 'desc' },
        select: {
            name: true,
            team: true,
            month: true,
            report_date: true,
            completed_month: true,
            state: true
        }
    });

    console.log(JSON.stringify(samples, null, 2));
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
