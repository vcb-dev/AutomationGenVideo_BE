const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const contentVideos = await prisma.contentVideo.findMany({
    orderBy: { created_at: 'desc' },
    take: 10,
    include: {
      team: true,
      period: true,
      editor: true,
    }
  });
  console.log('=== RECENT CONTENT VIDEOS ===');
  console.log(JSON.stringify(contentVideos, null, 2));

  const caseStudies = await prisma.caseStudy.findMany({
    orderBy: { created_at: 'desc' },
    take: 10,
    include: {
      team: true,
      period: true,
      creator: true,
    }
  });
  console.log('=== RECENT CASE STUDIES ===');
  console.log(JSON.stringify(caseStudies, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
