import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function replacer(key: string, value: any) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

async function main() {
  const vids = await prisma.contentVideo.findMany({
    include: {
      team: true,
      period: true,
    }
  });
  console.log('=== ALL CONTENT VIDEOS ===');
  console.log(JSON.stringify(vids, replacer, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
