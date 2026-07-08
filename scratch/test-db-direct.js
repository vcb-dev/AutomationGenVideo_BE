const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_DATABASE_URL
    }
  }
});

async function run() {
  try {
    console.log("Testing DIRECT DB connection via Prisma Client...");
    const count = await prisma.user.count();
    console.log(`✅ SUCCESS! Direct Prisma connected and found ${count} users.`);
  } catch (err) {
    console.error(`❌ FAILED: ${err.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

run();
