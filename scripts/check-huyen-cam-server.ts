import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const url = process.env.SERVER_DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  console.log('🔍 Searching for "Huyền Cam" in Kpi on Server...');

  const records = await (prisma as any).kpi.findMany({
    where: {
      OR: [
        { name: { contains: 'Huyền Cam' } },
        { name: { contains: 'Cam Huyền' } }
      ]
    }
  });

  if (records.length === 0) {
    console.log('❌ No records found for "Huyền Cam".');
  } else {
    console.table(records.map((r: any) => ({
      id: r.id,
      name: r.name,
      team: r.team,
      report_date: r.report_date,
      month: r.month
    })));
  }

  await prisma.$disconnect();
}

main();
