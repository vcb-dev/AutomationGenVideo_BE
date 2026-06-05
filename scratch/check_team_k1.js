const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== SEARCHING FOR TEAM K1 IN LARK_REPORTS ===');
  
  // Find all reports from Team K1
  const k1Reports = await prisma.larkReport.findMany({
    where: {
      team: {
        contains: 'K1',
        mode: 'insensitive'
      }
    },
    orderBy: {
      date: 'desc'
    }
  });

  console.log(`Total reports for Team K1: ${k1Reports.length}`);
  
  // Get unique names in Team K1 reports
  const uniqueNames = [...new Set(k1Reports.map(r => r.name))];
  console.log('Unique names in Team K1 reports:', uniqueNames);

  // Check if any report name contains "Anh" in Team K1
  const anhReports = k1Reports.filter(r => r.name.toLowerCase().includes('anh'));
  console.log(`Reports in Team K1 with 'Anh' in name: ${anhReports.length}`);
  anhReports.forEach(r => {
    console.log(`- ${r.name} (Date: ${r.date ? r.date.toISOString() : 'N/A'}, CreatedAt: ${r.created_at.toISOString()})`);
  });

  console.log('\n=== SEARCHING FOR TEAM K1 IN LARK_PERMISSIONS ===');
  const k1Permissions = await prisma.larkPermission.findMany({
    where: {
      team: {
        contains: 'K1',
        mode: 'insensitive'
      }
    }
  });
  console.log(`Total permissions for Team K1: ${k1Permissions.length}`);
  k1Permissions.forEach(p => {
    console.log(`- Name: ${p.name}, Email: ${p.email}, Role: ${p.role}`);
  });

  // Check if anyone in LarkPermission contains "Anh" regardless of team
  console.log('\n=== SEARCHING FOR ANYONE WITH "ANH" IN LARK_PERMISSIONS ===');
  const allAnhPermissions = await prisma.larkPermission.findMany({
    where: {
      name: {
        contains: 'Anh',
        mode: 'insensitive'
      }
    }
  });
  console.log(`Total permissions with 'Anh' in name: ${allAnhPermissions.length}`);
  allAnhPermissions.forEach(p => {
    console.log(`- Name: ${p.name}, Team: ${p.team}, Email: ${p.email}, Role: ${p.role}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
