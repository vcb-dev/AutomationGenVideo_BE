import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixChannel() {
  try {
    console.log('🔧 Fixing vieeha925 channel data...\n');
    
    const result = await prisma.trackedChannel.updateMany({
      where: {
        username: 'vieeha925',
        platform: 'TIKTOK',
      },
      data: {
        total_videos: 0,
        total_views: BigInt(0),
        total_likes: BigInt(0),
        engagement_rate: 0,
      },
    });
    
    console.log(`✅ Updated ${result.count} channel(s)`);
    
    // Verify
    const channel = await prisma.trackedChannel.findFirst({
      where: {
        username: 'vieeha925',
        platform: 'TIKTOK',
      },
    });
    
    if (channel) {
      console.log('\n📊 Updated channel data:');
      console.log(`   Username: ${channel.username}`);
      console.log(`   Videos: ${channel.total_videos}`);
      console.log(`   Followers: ${channel.total_followers}`);
      console.log(`   Views: ${channel.total_views}`);
      console.log(`   Likes: ${channel.total_likes}`);
      console.log(`   Engagement: ${channel.engagement_rate}%`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixChannel();
