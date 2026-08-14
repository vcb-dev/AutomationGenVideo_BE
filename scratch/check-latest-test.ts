import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.contentTransformHistory.findMany({
    where: { user_id: '4b9f490e-d903-4360-bc81-a9e48b77e2e8' },
    orderBy: { created_at: 'desc' },
    take: 1,
    select: { id: true, created_at: true, status: true, duration_ms: true, overall_score: true, error_message: true, output_text: true },
  });
  console.log(JSON.stringify(rows.map(r => ({...r, output_text: r.output_text ? `[${r.output_text.length} chars]` : null})), null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
