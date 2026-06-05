const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== SEARCHING FOR KIEU ANH IN ALL DATABASE TABLES ===');
  
  // 1. Check User table
  try {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: 'Anh', mode: 'insensitive' } },
          { email: { contains: 'kieu_anh', mode: 'insensitive' } }
        ]
      }
    });
    console.log(`Users with "Anh" or "kieu_anh": ${users.length}`);
    users.forEach(u => console.log(`- User ID: ${u.id}, Name: ${u.name}, Email: ${u.email}`));
  } catch (e) {
    console.log('Error checking User table:', e.message);
  }

  // 2. Check LarkKPI table
  try {
    const kpis = await prisma.larkKPI.findMany({
      where: {
        OR: [
          { name: { contains: 'Anh', mode: 'insensitive' } },
          { name: { contains: 'Kiều Anh', mode: 'insensitive' } }
        ]
      }
    });
    console.log(`LarkKPIs with "Anh": ${kpis.length}`);
    const uniqueKpiNames = [...new Set(kpis.map(k => k.name))];
    console.log('Unique names in LarkKPI matching "Anh":', uniqueKpiNames);
  } catch (e) {
    console.log('Error checking LarkKPI table:', e.message);
  }

  // 3. Check LarkTraffic table
  try {
    const traffics = await prisma.larkTraffic.findMany({
      where: {
        OR: [
          { name: { contains: 'Anh', mode: 'insensitive' } },
          { email: { contains: 'kieu_anh', mode: 'insensitive' } }
        ]
      }
    });
    console.log(`LarkTraffic records with "Anh": ${traffics.length}`);
    const uniqueTrafficNames = [...new Set(traffics.map(t => t.name))];
    console.log('Unique names in LarkTraffic matching "Anh":', uniqueTrafficNames);
  } catch (e) {
    console.log('Error checking LarkTraffic table:', e.message);
  }

  // 4. Check ReportOutstanding table
  try {
    const outstandings = await prisma.reportOutstanding.findMany({
      where: {
        OR: [
          { name: { contains: 'Anh', mode: 'insensitive' } }
        ]
      }
    });
    console.log(`ReportOutstanding records with "Anh": ${outstandings.length}`);
    const uniqueOutstandingNames = [...new Set(outstandings.map(o => o.name))];
    console.log('Unique names in ReportOutstanding matching "Anh":', uniqueOutstandingNames);
  } catch (e) {
    console.log('Error checking ReportOutstanding table:', e.message);
  }

  // Let's count LarkReport, LarkPermission, LarkKPI to make sure they have data
  const reportCount = await prisma.larkReport.count();
  const permissionCount = await prisma.larkPermission.count();
  const kpiCount = await prisma.larkKPI.count();
  console.log(`\nTable counts - Reports: ${reportCount}, Permissions: ${permissionCount}, KPIs: ${kpiCount}`);
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
