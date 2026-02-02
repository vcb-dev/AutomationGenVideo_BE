import { PrismaClient, Platform } from '@prisma/client';

const prisma = new PrismaClient();

async function clearFacebookData() {
  console.log('🗑️  Starting Facebook data cleanup...\n');

  try {
    // 1. Delete all Facebook video posts
    const deletedPosts = await prisma.videoPost.deleteMany({
      where: {
        platform: Platform.FACEBOOK,
      },
    });
    console.log(`✅ Deleted ${deletedPosts.count} Facebook video posts`);

    // 2. Delete all Facebook tracked channels
    const deletedChannels = await prisma.trackedChannel.deleteMany({
      where: {
        platform: Platform.FACEBOOK,
      },
    });
    console.log(`✅ Deleted ${deletedChannels.count} Facebook tracked channels`);

    console.log('\n🎉 Facebook data cleanup completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`  - Video Posts: ${deletedPosts.count}`);
    console.log(`  - Tracked Channels: ${deletedChannels.count}`);
    console.log(`  - Total Deleted: ${deletedPosts.count + deletedChannels.count}`);
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the cleanup
clearFacebookData()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });
