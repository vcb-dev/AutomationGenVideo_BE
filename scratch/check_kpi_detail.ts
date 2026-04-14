import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const kpi = await prisma.larkKPI.findFirst({
        where: { name: 'Chung Đỗ ', report_date: new Date('2026-04-13T05:00:00.000Z') }
    });
    console.log(kpi);

    const nguyenToanDb = await prisma.larkKPI.findFirst({
        where: { name: 'Nguyễn Toán ' }
    });
    console.log("Toan's team:", nguyenToanDb?.team, "| Chung do team:", kpi?.team);
}

main().finally(() => prisma.$disconnect());
