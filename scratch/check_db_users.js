import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
    const users = await prisma.user.findMany({
        where: {
            team: { contains: 'JP1' }
        },
        select: { full_name: true, team: true, employee_status: true, email: true }
    });
    console.log("Users in JP1:", users);
    prisma.$disconnect();
}
check();
