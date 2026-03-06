
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Checking Position for Leaders ---');
    const leaders = ['Đỗ Thị Nga', 'Lệnh Ngọc Khánh'];

    for (const name of leaders) {
        console.log(`\nResults for: ${name}`);
        // Check lark_permissions where role is leader
        const permission = await prisma.larkPermission.findFirst({
            where: {
                name: { contains: name, mode: 'insensitive' }
            }
        });
        console.log('Permission Position:', permission?.position);
        console.log('Permission Role:', permission?.role);

        // Check reports
        const report = await prisma.larkReport.findFirst({
            where: {
                name: { contains: name, mode: 'insensitive' }
            },
            orderBy: { date: 'desc' }
        });
        console.log('Report Question 1 Key:', report?.answers ? Object.keys(JSON.parse(report.answers as string))[0] : 'None');
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
