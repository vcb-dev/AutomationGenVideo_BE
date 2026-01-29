import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Updating database schema...");
  try {
    // 1. Add fields to 'videos' table
    try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "content_hash" TEXT;`);
        console.log("Added content_hash to videos");
    } catch (e: any) {
        console.log("Error adding content_hash (might exist):", e.message);
    }
    
    try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "file_url" TEXT;`);
        console.log("Added file_url to videos");
    } catch (e: any) {
        console.log("Error adding file_url (might exist):", e.message);
    }

    // 2. Add fields to 'tracked_channels' table
    try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "tracked_channels" ADD COLUMN IF NOT EXISTS "initial_video_count" INTEGER DEFAULT 0;`);
        console.log("Added initial_video_count to tracked_channels");
    } catch (e: any) {
        console.log("Error adding initial_video_count (might exist):", e.message);
    }

    console.log("Database schema updated successfully via raw SQL.");
  } catch (e) {
    console.error("Critical error:", e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
