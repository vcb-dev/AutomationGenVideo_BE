const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.trafficReport.findMany({
    where: {
      OR: [
        { name: { contains: 'Hữu Hà', mode: 'insensitive' } },
        { name: { contains: 'Huu Ha', mode: 'insensitive' } },
      ],
    },
    orderBy: { date: 'desc' },
    take: 15,
  });

  console.log(`Found ${rows.length} rows`);
  rows.forEach(r => {
    console.log(JSON.stringify({
      id: r.id,
      name: r.name,
      team: r.team,
      email: r.email,
      date: r.date,
      month: r.month,
      traffic_fb: r.traffic_fb?.toString(),
      channel_fb: r.channel_fb,
      total_traffic: r.total_traffic?.toString(),
      is_confirmed: r.is_confirmed,
      updated_at: r.updated_at,
    }));
  });
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
