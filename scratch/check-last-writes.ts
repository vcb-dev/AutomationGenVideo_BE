import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  for (const t of ['kpi', 'reported_tasks', 'traffic_reports', 'checklist_reports']) {
    const r: { last_created: Date | null; last_updated: Date | null; total: bigint }[] =
      await prisma.$queryRawUnsafe(
        `SELECT MAX(created_at) AS last_created, MAX(updated_at) AS last_updated, COUNT(*)::bigint AS total FROM "${t}"`,
      );
    console.log(
      `${t}: ${Number(r[0].total)} dòng, tạo gần nhất ${r[0].last_created?.toISOString()}, sửa gần nhất ${r[0].last_updated?.toISOString()}`,
    );
  }
}

main().finally(() => prisma.$disconnect());
