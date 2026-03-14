
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const channels = await prisma.channel.findMany({
    where: {
      owner: { contains: 'Nguyễn Toán', mode: 'insensitive' }
    },
    select: {
      name: true,
      platform: true
    }
  });
  console.log(JSON.stringify(channels, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
