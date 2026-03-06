
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Collecting All Unique Answer Keys ---');
    const reports = await prisma.larkReport.findMany({
        select: { answers: true },
        where: { answers: { not: null } },
        take: 1000 // Sample 1000 records
    });

    const allKeys = new Set<string>();

    reports.forEach(r => {
        let answers: any = r.answers;
        if (typeof answers === 'string') {
            try { answers = JSON.parse(answers); } catch (e) { }
        }
        if (answers && typeof answers === 'object') {
            Object.keys(answers).forEach(k => allKeys.add(k));
        }
    });

    console.log('Unique Keys found:');
    Array.from(allKeys).sort().forEach(k => console.log(`- ${k}`));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
