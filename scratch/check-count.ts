import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const count = await prisma.larkListTask.count();
  console.log(`LarkListTask count: ${count}`);
  await prisma.$disconnect();
}

main();
