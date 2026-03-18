
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Checking Positions (users + Lark fields) ---');
    const leaders = ['Đỗ Thị Nga', 'Lệnh Ngọc Khánh'];

    for (const name of leaders) {
        console.log(`\nResults for: ${name}`);
        const employee = await prisma.user.findFirst({
            where: {
                full_name: { contains: name, mode: 'insensitive' },
                lark_employee_record_id: { not: null },
            },
        });
        console.log('Employee Position:', employee?.employee_position);
        console.log('Employee Team:', employee?.team);

        // Check recent reports
        const report = await prisma.larkReport.findFirst({
            where: {
                name: { contains: name, mode: 'insensitive' }
            },
            orderBy: { date: 'desc' }
        });

        if (report?.answers) {
            const answers = JSON.parse(report.answers as string);
            console.log('Report Question Keys:', Object.keys(answers).filter(k => k.match(/^\d\./)));
        } else {
            console.log('No report answers found.');
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
