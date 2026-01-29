import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkChannels() {
  try {
    console.log('🔍 Checking all tracked channels...\n');
    
    const channels = await prisma.trackedChannel.findMany({
      orderBy: { created_at: 'desc' },
      take: 10,
    });
    
    console.log(`Found ${channels.length} channels:\n`);
    
    channels.forEach((ch, idx) => {
      console.log(`${idx + 1}. ${ch.username} (@${ch.platform})`);
      console.log(`   Display: ${ch.display_name}`);
      console.log(`   Videos: ${ch.total_videos}`);
      console.log(`   Followers: ${ch.total_followers}`);
      console.log(`   Likes: ${ch.total_likes}`);
      console.log(`   Views: ${ch.total_views}`);
      console.log(`   Engagement: ${ch.engagement_rate}%`);
      console.log(`   Created: ${ch.created_at}`);
      console.log(`   Last synced: ${ch.last_synced_at}\n`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkChannels();
