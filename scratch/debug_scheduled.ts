import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const posts = await prisma.socialPost.findMany({
    where: { source: 'SCHEDULED' },
    orderBy: { created_at: 'desc' },
    take: 5
  });

  console.log(JSON.stringify(posts, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
