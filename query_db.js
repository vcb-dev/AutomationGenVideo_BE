const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const permissions = await prisma.larkPermission.findMany();
    console.log('Permissions:', JSON.stringify(permissions, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
