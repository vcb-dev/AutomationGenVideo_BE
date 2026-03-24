const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const reports = await prisma.larkReport.findMany({
    where: {
      email: { contains: 'hthuha' }
    }
  });
  console.log("REPORTS:", reports.map(r=>({id: r.id, name:r.name, email:r.email, team:r.team})));

  const outstandings = await prisma.$queryRawUnsafe(`SELECT id, name, email, team, category, content FROM report_outstanding WHERE email ILIKE '%hthuha%' LIMIT 10`);
  console.log("OUTSTANDINGS:", outstandings);
}

main()
  .catch(e => { console.error('ERROR:', e.message); })
  .finally(() => prisma.$disconnect());
