import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("DATABASE_URL:", process.env.DATABASE_URL);
  
  try {
    const tables = await prisma.$queryRawUnsafe(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
    console.log("Tables:", tables);
  } catch (e: any) {
    console.error("Failed to query tables:", e.message);
  }

  try {
    const reports = await prisma.$queryRawUnsafe(`
      SELECT id, name, date, created_at, email
      FROM "checklist_reports"
      ORDER BY date DESC NULLS LAST
      LIMIT 15;
    `);
    console.log("Recent reports in DB:", reports);
  } catch (e: any) {
    console.error("Failed to query reports:", e.message);
  }
}

main().then(() => prisma.$disconnect());
