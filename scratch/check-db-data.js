const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== DATABASE DIAGNOSTICS ===');
  
  // 1. Check Teams
  const teams = await prisma.team.findMany();
  console.log('1. Teams count:', teams.length);
  for (const t of teams) {
    console.log(`   - Team: ID=${t.id}, Name=${t.name}`);
  }

  // 2. Check Report Periods
  const periods = await prisma.reportPeriod.findMany();
  console.log('\n2. Report Periods count:', periods.length);
  for (const p of periods) {
    console.log(`   - Period: ID=${p.id}, Label=${p.label}, Type=${p.type}`);
  }

  // 3. Check Content Videos
  const totalVideos = await prisma.contentVideo.count();
  console.log('\n3. Total Content Videos:', totalVideos);

  if (totalVideos > 0) {
    const videosGrouped = await prisma.contentVideo.groupBy({
      by: ['team_id', 'period_id', 'status'],
      _count: true,
    });
    console.log('   Grouped by team & period & status:');
    for (const g of videosGrouped) {
      const team = teams.find(t => t.id === g.team_id);
      const period = periods.find(p => p.id === g.period_id);
      console.log(`   - Team: ${team ? team.name : g.team_id}, Period: ${period ? period.label : g.period_id}, Status: ${g.status} -> Count: ${g._count}`);
    }

    // Print top 5 video details
    const sampleVids = await prisma.contentVideo.findMany({
      take: 5,
      include: {
        team: true,
        period: true,
      }
    });
    console.log('\n4. Sample videos:');
    for (const v of sampleVids) {
      console.log(`   - ID=${v.id}, Title=${v.title}, Team=${v.team.name}, Period=${v.period.label}, Status=${v.status}`);
    }
  } else {
    console.log('   ℹ No content videos found in the database.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
