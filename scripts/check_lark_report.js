const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const result = await prisma.$queryRawUnsafe(`
      SELECT id, name, team, email, date, created_at, answers
      FROM "checklist_reports"
      WHERE id LIKE 'local_chk_%' OR date >= '2026-05-01'::timestamp
      ORDER BY created_at DESC;
    `);
    console.log("Local or recent reports in DB:", result);
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
