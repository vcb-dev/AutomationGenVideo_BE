import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  try {
    console.log("Running alter social_posts...");
    await prisma.$executeRawUnsafe(`ALTER TABLE "social_posts" ADD COLUMN IF NOT EXISTS "thumb_url" TEXT;`);
    console.log("Alter social_posts ok");
  } catch (e: any) {
    console.error("Alter social_posts failed:", e.message);
  }
  try {
    console.log("Running alter social_drafts...");
    await prisma.$executeRawUnsafe(`ALTER TABLE "social_drafts" ADD COLUMN IF NOT EXISTS "thumb_url" TEXT;`);
    console.log("Alter social_drafts ok");
  } catch (e: any) {
    console.error("Alter social_drafts failed:", e.message);
  }
  try {
    console.log("Running alter constraint...");
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
    `).catch(err => {
      if (err.message.includes("already exists")) {
        console.log("Constraint already exists, skipping");
      } else {
        throw err;
      }
    });
    console.log("Alter constraint ok");
  } catch (e: any) {
    console.error("Alter constraint failed:", e.message);
  }
}
run().then(() => prisma.$disconnect());
