
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const roles = await prisma.rolePermission.findMany();
    console.log('Role Permissions in DB:', JSON.stringify(roles, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
