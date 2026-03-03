
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    console.log('--- Users ---');
    const users = await prisma.user.findMany();
    console.log(JSON.stringify(users, null, 2));

    console.log('\n--- Lark Permissions ---');
    const permissions = await prisma.larkPermission.findMany();
    console.log(JSON.stringify(permissions, null, 2));
}

run().finally(() => prisma.$disconnect());
