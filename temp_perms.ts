import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
    datasources: { db: { url: "postgresql://postgres:postgres@127.0.0.1:5432/video_production?schema=public" } }
});

async function main() {
  const perms = await prisma.larkPermission.findMany({ take: 5 });
  console.log(JSON.stringify(perms, null, 2));
}

main().finally(() => prisma.$disconnect());
