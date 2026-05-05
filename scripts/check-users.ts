import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const users = await prisma.user.findMany({
        where: { OR: [
            { full_name: { contains: 'Khánh' } }, 
            { full_name: { contains: 'Linh Chi' } }
        ]},
        select: { full_name: true, is_active: true, team: true, employee_status: true }
    });
    console.log(users);
}
main().finally(() => prisma.$disconnect());
