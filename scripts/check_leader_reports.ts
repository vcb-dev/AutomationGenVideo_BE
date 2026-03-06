
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Checking Leader Reports ---');
    const leaders = ['Đỗ Thị Nga', 'Lệnh Ngọc Khánh'];

    for (const name of leaders) {
        console.log(`\nResults for: ${name}`);
        const reports = await prisma.larkReport.findMany({
            where: {
                name: { contains: name, mode: 'insensitive' }
            },
            take: 1,
            orderBy: { date: 'desc' }
        });

        if (reports.length > 0) {
            const report = reports[0];
            console.log(`Report Date: ${report.date}`);
            console.log('Answers JSON keys:');
            let answers: any = report.answers;
            if (typeof answers === 'string') {
                try {
                    answers = JSON.parse(answers);
                } catch (e) {
                    console.log('Failed to parse answers string');
                }
            }
            if (answers && typeof answers === 'object') {
                Object.keys(answers).forEach((k, idx) => {
                    console.log(`${idx + 1}. ${k}`);
                    console.log(`   Value: ${answers[k]}`);
                });
            } else {
                console.log('No answers found or invalid format');
            }
        } else {
            console.log('No reports found');
        }
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
