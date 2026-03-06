
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Checking Recent Reports for Leaders ---');
    const names = ['Đỗ Thị Nga', 'Lệnh Ngọc Khánh', 'Nga', 'Khánh'];

    for (const name of names) {
        console.log(`\nSearching for: ${name}`);
        const reports = await prisma.larkReport.findMany({
            where: {
                name: { contains: name, mode: 'insensitive' }
            },
            orderBy: { date: 'desc' },
            take: 3
        });

        console.log(`Found ${reports.length} reports.`);
        reports.forEach((r, i) => {
            console.log(`Report ${i + 1}: Date: ${r.date}, Name: ${r.name}`);
            if (r.answers) {
                const ans = typeof r.answers === 'string' ? JSON.parse(r.answers) : r.answers;
                console.log('Keys:', Object.keys(ans).filter(k => k.includes('?') || k.match(/^\d/)));
            } else {
                console.log('No answers.');
            }
        });
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
