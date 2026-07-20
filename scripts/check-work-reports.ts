import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    try {
        const result = await prisma.$queryRawUnsafe(`
          SELECT DISTINCT DATE_TRUNC('day', report_date) as report_day, COUNT(*) as count
          FROM "kpi"
          GROUP BY report_day
          ORDER BY report_day DESC NULLS LAST
          LIMIT 20;
        `);
        console.log("Distinct kpi days in DB:", result);
    } catch (e: any) {
        console.error("Error checking work_reports:", e.message);
    }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
