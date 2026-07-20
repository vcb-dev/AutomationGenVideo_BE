import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const accounts = await prisma.socialAccount.findMany({
    where: {
      platform: 'YOUTUBE',
    },
    select: {
      id: true,
      name: true,
      username: true,
      platform: true,
      is_active: true,
      created_at: true,
    }
  });
  console.log('--- YOUTUBE ACCOUNTS ---');
  console.log(JSON.stringify(accounts, null, 2));
  console.log('------------------------');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
