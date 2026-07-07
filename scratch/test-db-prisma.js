const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    console.log("Testing DB connection via Prisma Client...");
    const count = await prisma.user.count();
    console.log(`✅ SUCCESS! Prisma connected and found ${count} users.`);
  } catch (err) {
    console.error(`❌ FAILED: ${err.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

run();
