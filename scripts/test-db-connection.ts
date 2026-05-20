import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("process.env.DATABASE_URL:", process.env.DATABASE_URL);
  try {
    const dbInfo = await prisma.$queryRawUnsafe(`
      SELECT current_database(), current_schema(), current_user;
    `);
    console.log("DB Info:", dbInfo);
  } catch (e: any) {
    console.error("Failed to query DB Info:", e.message);
  }

  try {
    const result = await prisma.$queryRawUnsafe(`
      ALTER TABLE "social_posts" ADD COLUMN IF NOT EXISTS "thumb_url" TEXT;
    `);
    console.log("Alter social_posts raw result:", result);
  } catch (e: any) {
    console.error("Alter social_posts failed with error:", e.message);
  }
}

main().then(() => prisma.$disconnect());
