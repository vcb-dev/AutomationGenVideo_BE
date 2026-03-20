import { PrismaClient } from '@prisma/client';

const prismaLocal = new PrismaClient({
  datasources: { db: { url: "postgresql://postgres:postgres@127.0.0.1:5432/video_production?schema=public" } }
});

const prismaCloud = new PrismaClient({
  datasources: { db: { url: "postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?schema=public" } }
});

async function main() {
  const localUsers = await prismaLocal.user.findMany();
  let updated = 0;
  
  for (const user of localUsers) {
    try {
      await prismaCloud.user.update({
        where: { email: user.email },
        data: {
          roles: user.roles,
          team: user.team,
          full_name: user.full_name,
        }
      });
      console.log(`Updated roles for ${user.email} -> ${user.roles.join(', ')}`);
      updated++;
    } catch (e) {
      // Ignored if user not on cloud yet or other err
    }
  }

  console.log(`--- SYNC COMPLETED SUCCESSFULLY. Updated ${updated} users ---`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaLocal.$disconnect();
    await prismaCloud.$disconnect();
  });
