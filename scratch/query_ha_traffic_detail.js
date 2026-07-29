const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== TOAN BO CAC DONG FACEBOOK NGAY 2026-07-14 CUA Nguyen Huu Ha ===');
  const fbToday = await prisma.trafficReport.findMany({
    where: {
      name: { contains: 'Hữu Hà', mode: 'insensitive' },
      date: new Date('2026-07-14T00:00:00.000Z'),
      channel_fb: { not: null },
    },
  });
  console.log(`Found ${fbToday.length} dong FB cho ngay 2026-07-14`);
  fbToday.forEach(r => console.log(JSON.stringify(r, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2)));

  console.log('\n=== LICH SU TRAFFIC FACEBOOK 14 NGAY GAN NHAT (de doi chieu) ===');
  const history = await prisma.trafficReport.findMany({
    where: {
      name: { contains: 'Hữu Hà', mode: 'insensitive' },
      channel_fb: { not: null },
    },
    orderBy: { date: 'desc' },
    take: 14,
    select: { id: true, date: true, traffic_fb: true, channel_fb: true, is_confirmed: true, updated_at: true },
  });
  history.forEach(r => console.log(JSON.stringify(r, (k, v) => typeof v === 'bigint' ? v.toString() : v)));
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
