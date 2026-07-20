const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== SEARCHING FOR NGUYEN KIEU ANH ===');
  
  // 1. All records in lark_reports where name contains "Kiều Anh" or "Kieu Anh" or "Nguyen Kieu Anh"
  const reports = await prisma.larkReport.findMany({
    where: {
      OR: [
        { name: { contains: 'Kiều Anh', mode: 'insensitive' } },
        { name: { contains: 'Kieu Anh', mode: 'insensitive' } },
        { name: { contains: 'Nguyen Kieu Anh', mode: 'insensitive' } }
      ]
    },
    orderBy: {
      date: 'desc'
    }
  });

  console.log(`Total reports found for Kiều Anh: ${reports.length}`);
  reports.forEach(r => {
    console.log(`- ID: ${r.id}`);
    console.log(`  Name: ${r.name}`);
    console.log(`  Team: ${r.team}`);
    console.log(`  Email: ${r.email}`);
    console.log(`  Role: ${r.role}`);
    console.log(`  Date: ${r.date ? r.date.toISOString() : 'N/A'}`);
    console.log(`  CreatedAt: ${r.created_at ? r.created_at.toISOString() : 'N/A'}`);
  });

  // 2. Also check if there's any user in LarkPermission or other tables to see if she goes by another name
  console.log('=== SEARCHING FOR KIEU ANH IN LARK PERMISSIONS ===');
  const permissions = await prisma.larkPermission.findMany({
    where: {
      OR: [
        { name: { contains: 'Kiều Anh', mode: 'insensitive' } },
        { name: { contains: 'Kieu Anh', mode: 'insensitive' } }
      ]
    }
  });
  console.log(`Total permissions found: ${permissions.length}`);
  permissions.forEach(p => {
    console.log(`- Name: ${p.name}, Email: ${p.email}, Team: ${p.team}, Role: ${p.role}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
