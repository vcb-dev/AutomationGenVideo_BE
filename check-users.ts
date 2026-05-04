import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const users = await prisma.user.findMany({
        where: { full_name: { in: ['Lệnh Ngọc Khánh', 'Khánh Lệnh Ngọc', 'Nguyễn Linh Chi', 'Linh Chi Nguyễn'] } },
        select: { full_name: true, is_active: true, team: true }
    });
    console.log(users);
}
main().finally(() => prisma.$disconnect());
