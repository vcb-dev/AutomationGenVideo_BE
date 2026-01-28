const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkTrackedChannels() {
  try {
    const channels = await prisma.trackedChannel.findMany();
    
    console.log('=== TRACKED CHANNELS ===\n');
    
    channels.forEach((ch, idx) => {
      console.log(`Channel ${idx + 1}:`);
      console.log(`  ID: ${ch.id}`);
      console.log(`  Username: ${ch.username}`);
      console.log(`  Display Name: ${ch.display_name}`);
      console.log(`  Platform: ${ch.platform}`);
      console.log(`  Total Followers: ${ch.total_followers}`);
      console.log(`  Total Likes: ${ch.total_likes}`);
      console.log(`  Total Views: ${ch.total_views}`);
      console.log(`  Total Videos: ${ch.total_videos}`);
      console.log('---\n');
    });
    
    console.log(`Total channels: ${channels.length}`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTrackedChannels();
