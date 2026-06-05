const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== NGUYEN KIEU ANH IN LARK_KPI ===');
  const kpis = await prisma.larkKPI.findMany({
    where: {
      name: 'Nguyen Kieu Anh'
    },
    orderBy: {
      report_date: 'desc'
    },
    take: 10
  });
  
  console.log(`Found ${kpis.length} KPI records:`);
  kpis.forEach(k => {
    console.log(`- ID: ${k.id}, Name: ${k.name}, Team: ${k.team}, Date: ${k.report_date ? k.report_date.toISOString() : 'N/A'}, Month: ${k.month}, State: ${k.state}, UpdatedAt: ${k.updated_at.toISOString()}`);
  });

  console.log('\n=== NGUYEN KIEU ANH IN LARK_TRAFFIC ===');
  const traffics = await prisma.larkTraffic.findMany({
    where: {
      name: 'Nguyen Kieu Anh'
    },
    orderBy: {
      date: 'desc'
    },
    take: 10
  });
  
  console.log(`Found ${traffics.length} Traffic records:`);
  traffics.forEach(t => {
    console.log(`- ID: ${t.id}, Name: ${t.name}, Team: ${t.team}, Date: ${t.date ? t.date.toISOString() : 'N/A'}, Email: ${t.email}, UpdatedAt: ${t.updated_at.toISOString()}`);
  });

  // Get her email from these records if possible
  const emails = [...new Set([
    ...kpis.map(k => k.employee_id).filter(Boolean),
    ...traffics.map(t => t.email).filter(Boolean)
  ])];
  console.log('\nDetected Email/ID for Nguyen Kieu Anh:', emails);

  // Search lark_reports using these emails or any other fields
  if (emails.length > 0) {
    console.log('\n=== SEARCHING LARK_REPORTS BY EMAIL OR EMPLOYEE_ID ===');
    const reportsByEmail = await prisma.larkReport.findMany({
      where: {
        OR: [
          { email: { in: emails } },
          { id: { in: emails } }
        ]
      }
    });
    console.log(`Found ${reportsByEmail.length} reports in lark_reports by email/ID:`);
    reportsByEmail.forEach(r => {
      console.log(`- ID: ${r.id}, Name: ${r.name}, Team: ${r.team}, Date: ${r.date ? r.date.toISOString() : 'N/A'}, Email: ${r.email}, CreatedAt: ${r.created_at.toISOString()}`);
    });
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
