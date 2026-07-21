import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const prisma = new PrismaClient();
  const now = new Date();
  console.log('Query time (UTC):', now.toISOString());

  // Correct VN-day bounds for calendar date '2026-07-20' per code's own getVietnamBounds logic:
  // start = UTC (D-1) 17:00, end = UTC D 16:59:59
  const start = new Date('2026-07-19T17:00:00.000Z');
  const end = new Date('2026-07-20T16:59:59.999Z');
  console.log('Querying bounds:', start.toISOString(), '..', end.toISOString());

  const recent = await prisma.checklistReport.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { created_at: 'desc' },
    take: 15,
    select: { id: true, name: true, team: true, email: true, date: true, created_at: true, updated_at: true },
  });
  console.log('Most recent submissions in this bucket (max 15):');
  recent.forEach(r => {
    console.log(`  created=${r.created_at.toISOString()} name=${r.name} team=${r.team} email=${r.email}`);
  });

  const total = await prisma.checklistReport.count({ where: { date: { gte: start, lte: end } } });
  console.log('Total count for this date bucket right now:', total);

  await prisma.$disconnect();
}
main().catch(e => { console.error('ERROR', e); process.exit(1); });
