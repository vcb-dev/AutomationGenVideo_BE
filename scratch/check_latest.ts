import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const latest = await prisma.larkKPI.findFirst({
        orderBy: { id: 'desc' }, // Use ID desc or something reliable to see recent inserts
        select: {
            name: true,
            team: true,
            month: true,
            report_date: true,
            created_at: true
        }
    });

    console.log(JSON.stringify(latest, null, 2));

    const counts = await prisma.larkKPI.groupBy({
        by: ['month'],
        _count: {
            _all: true
        }
    });
    console.log('Month counts:', JSON.stringify(counts, null, 2));
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
