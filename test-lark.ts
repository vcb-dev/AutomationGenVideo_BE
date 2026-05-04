import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const lk = await prisma.larkReport.findFirst({
        where: { name: { contains: 'Khánh Lệnh Ngọc' } },
        orderBy: { date: 'desc' }
    });
    console.log(lk);
}
main().finally(() => prisma.$disconnect());
