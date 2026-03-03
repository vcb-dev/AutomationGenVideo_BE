
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    console.log('--- User table roles ---');
    const users = await prisma.user.findMany({ select: { roles: true, email: true } });
    const allRoles = new Set();
    users.forEach(u => u.roles.forEach(r => allRoles.add(r)));
    console.log('Roles found in DB:', Array.from(allRoles));
    console.log('User sample:', JSON.stringify(users.slice(0, 5), null, 2));
}
run().finally(() => prisma.$disconnect());
