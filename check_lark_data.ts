
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const count = await prisma.larkReport.count();
    console.log(`\n================================`);
    console.log(`TỔNG SỐ BẢN GHI LARK TRONG DB: ${count}`);
    console.log(`================================\n`);

    const reports = await prisma.larkReport.findMany({ take: 3, orderBy: { created_at: 'desc' } });

    if (reports.length > 0) {
        console.log('3 BẢN GHI MỚI NHẤT:');
        for (let i = 0; i < reports.length; i++) {
            const record = reports[i];
            console.log(`[${i + 1}] ${record.name} - ${record.team}`);
            console.log(`    Status: ${record.status}`);
            console.log(`    Avatar: ${record.avatar || 'NULL'}`);
            console.log(`    Time: ${record.submitted_at}`);
            console.log('');
        }
    } else {
        console.log('Chưa có dữ liệu nào.');
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
