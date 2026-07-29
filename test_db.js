const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  try {
    const count = await prisma.user.count();
    console.log("DB is UP! Users count:", count);
  } catch (e) {
    console.error("DB connection error:", e.message);
  } finally {
    await prisma.$disconnect();
  }
}
main();
