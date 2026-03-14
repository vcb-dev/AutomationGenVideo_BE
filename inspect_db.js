
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const channel = await prisma.channel.findFirst({
    where: {
      owner: { contains: 'Nguyễn Toán', mode: 'insensitive' }
    }
  });
  console.log('Sample channel for Nguyễn Toán:', JSON.stringify(channel, null, 2));

  const allPlatforms = await prisma.channel.groupBy({
    by: ['platform'],
    _count: {
       _all: true
    }
  });
  console.log('All platform values in DB:', JSON.stringify(allPlatforms, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
