import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    console.log("=== SEARCHING FOR KHUE IN DB ===");
    const users = await prisma.user.findMany({
        where: {
            OR: [
                { full_name: { contains: 'Khuê', mode: 'insensitive' } },
                { email: { contains: 'khue', mode: 'insensitive' } }
            ]
        },
        select: { id: true, email: true, full_name: true, is_active: true, team: true, employee_status: true }
    });
    console.log("Users:", users);
}
main().finally(() => prisma.$disconnect());
