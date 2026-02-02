import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting to clear Facebook data from PostgreSQL...');

  try {
    // Delete TrackedChannels where platform is FACEBOOK
    // This should cascade delete related VideoPosts if configured, 
    // but looking at schema: @relation(..., onDelete: Cascade) is present on VideoPost.channel.
    const deletedChannels = await prisma.trackedChannel.deleteMany({
      where: {
        platform: 'FACEBOOK',
      },
    });

    console.log(`Successfully deleted ${deletedChannels.count} Facebook TrackedChannels.`);

    // Also delete any VideoPosts that might be orphaned or if cascade failed (unlikely but good to check)
    // Actually, let's just delete VideoPosts where platform is FACEBOOK just in case
    const deletedPosts = await prisma.videoPost.deleteMany({
      where: {
        platform: 'FACEBOOK',
      },
    });

    console.log(`Successfully deleted ${deletedPosts.count} Facebook VideoPosts.`);

  } catch (error) {
    console.error('Error clearing Facebook data:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
