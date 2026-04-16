import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const teams = await prisma.larkListTask.groupBy({
    by: ['team'],
    _count: {
       id: true
    }
  });
  console.log(JSON.stringify(teams, null, 2));
  await prisma.$disconnect();
}

main();
