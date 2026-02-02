import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Adding total_posts column to tracked_channels table...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "tracked_channels" 
      ADD COLUMN IF NOT EXISTS "total_posts" INTEGER NOT NULL DEFAULT 0;
    `);
    console.log('Successfully added total_posts column.');
  } catch (error) {
    console.error('Error adding column:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
