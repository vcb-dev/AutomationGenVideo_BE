const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const videos = await prisma.contentVideo.findMany({
      include: {
        team: true,
        period: true,
        editor: true
      }
    });
    console.log(`Content Videos in DB:`, videos);
  } catch (err) {
    console.error(`Error:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();
