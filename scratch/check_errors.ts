import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const posts = await prisma.socialPost.findMany({
    orderBy: { created_at: 'desc' },
    take: 5,
    include: {
      account: true
    }
  });

  for (const post of posts) {
    console.log(`Account: ${post.account.name} | Status: ${post.status} | Error: ${post.error_msg}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
