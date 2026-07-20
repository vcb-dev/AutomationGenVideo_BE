import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const indexes: any[] = await prisma.$queryRaw`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename IN ('lark_kpi', 'lark_report_kpi')
    `;
    console.log('Existing indexes on lark_kpi and lark_report_kpi:', indexes.map(i => i.indexname));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main().finally(() => prisma.$disconnect());
