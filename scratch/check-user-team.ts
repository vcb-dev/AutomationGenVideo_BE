import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const users = await prisma.user.findMany({
    where: { team: { not: null } },
    take: 5
  });
  console.log(JSON.stringify(users.map(u => ({ email: u.email, team: u.team })), null, 2));
  await prisma.$disconnect();
}

main();
