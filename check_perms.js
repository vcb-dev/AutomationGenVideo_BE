
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const count = await prisma.larkPermission.count();
    console.log(`LarkPermission Count: ${count}`);
    
    if (count > 0) {
      const samples = await prisma.larkPermission.findMany({ limit: 5 });
      console.log('Sample Permissions:', samples);
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
