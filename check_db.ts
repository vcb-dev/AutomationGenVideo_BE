import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("--- KIỂM TRA DỮ LIỆU DATABASE ---");
  
  const adsCount = await prisma.adsCampaignStats.count();
  console.log(`Bảng ads_campaign_stats: ${adsCount} dòng`);

  const socialCount = await prisma.socialVideoReport.count();
  console.log(`Bảng social_video_report: ${socialCount} dòng`);

  if (socialCount > 0) {
    const sample = await prisma.socialVideoReport.findMany({
      take: 5,
      select: { platform: true, year: true, month: true, views: true }
    });
    console.log("Mẫu dữ liệu Social:");
    console.table(sample);
  }

  const channelSample: any[] = await prisma.$queryRaw`SELECT channel_id, name FROM huyk_channels LIMIT 5`;
  console.log("Mẫu huyk_channels (channel_id):");
  console.table(channelSample);

  const socialSample = await prisma.socialVideoReport.findMany({
    take: 5,
    select: { username: true, channel_name: true }
  });
  console.log("Mẫu social_video_report (username):");
  console.table(socialSample);

  await prisma.$disconnect();
}

main().catch(console.error);
