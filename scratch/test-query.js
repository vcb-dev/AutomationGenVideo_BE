const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Querying teams...');
  try {
    const teams = await prisma.team.findMany();
    console.log('✓ Success! Teams:', teams.length);
  } catch (e) {
    console.error('✗ Failed:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
