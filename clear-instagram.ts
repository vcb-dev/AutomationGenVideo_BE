import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearInstagramData() {
  try {
    console.log('🗑️  Clearing Instagram data...');
    
    // Delete all Instagram tracked channels
    const deletedChannels = await prisma.trackedChannel.deleteMany({
      where: {
        platform: 'INSTAGRAM'
      }
    });
    
    console.log(`✅ Deleted ${deletedChannels.count} Instagram channels`);
    console.log('✅ Instagram data cleared successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearInstagramData();
