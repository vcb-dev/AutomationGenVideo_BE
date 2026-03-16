const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const allChannels = await prisma.channel.findMany({
    where: { status: 'Đang hoạt động' },
    select: { name: true, platform: true },
  });

  const platformMap = {
    'fb': ['fb', 'facebook', 'fanpage'],
    'ig': ['ig', 'instagram', 'ins'],
    'tiktok': ['tiktok', 'tt'],
    'yt': ['yt', 'youtube'],
    'thread': ['thread', 'threads'],
    'lemon8': ['lemon8', 'lemon 8'],
    'zalo': ['zalo', 'zalo oa', 'zalo video'],
    'twitter': ['twitter', 'twitter x', 'x']
  };

  const isPlatformMatch = (platformId, channelPlatform) => {
    if (!channelPlatform) return false;
    const p = channelPlatform.toLowerCase().trim();
    const targets = platformMap[platformId] || [platformId.toLowerCase()];
    return targets.some(target => {
      if (p === target) return true;
      if (target.length > 3 && p.includes(target)) return true;
      const words = p.split(/[\s_-]+/);
      if (words.includes(target)) return true;
      return false;
    });
  };

  console.log(`Total active channels: ${allChannels.length}`);
  
  allChannels.forEach(c => {
    const matchedCategories = Object.keys(platformMap).filter(cat => isPlatformMatch(cat, c.platform));
    if (matchedCategories.length > 1) {
      console.log(`[WARNING] Channel "${c.name}" matches MULTIPLE categories: ${matchedCategories.join(', ')} (Platform in DB: "${c.platform}")`);
    } else if (matchedCategories.length === 0) {
      console.log(`[INFO] Channel "${c.name}" matches NO categories (Platform in DB: "${c.platform}")`);
    }
  });

  // Specifically check for 'fb' matches that might be wrong
  console.log('\n--- Channels matching "fb" category ---');
  allChannels.filter(c => isPlatformMatch('fb', c.platform)).forEach(c => {
      console.log(`- "${c.name}" (Platform: "${c.platform}")`);
  });
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
