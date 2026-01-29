import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearTrackedChannels() {
  try {
    console.log('🗑️  Clearing all tracked channels...\n');
    
    const result = await prisma.trackedChannel.deleteMany({});
    
    console.log(`✅ Deleted ${result.count} tracked channel(s)`);
    console.log('\n✨ Database is now clean. You can add channels again.');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearTrackedChannels();
