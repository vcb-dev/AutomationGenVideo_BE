import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
  const rows: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      l.pid, a.usename, a.state, a.query,
      (now() - a.query_start)::text AS duration,
      (now() - a.xact_start)::text AS xact_duration,
      l.mode, l.granted, a.application_name
    FROM pg_locks l
    JOIN pg_stat_activity a ON l.pid = a.pid
    WHERE l.relation = '"users"'::regclass
    ORDER BY l.granted, xact_duration DESC NULLS LAST
  `);
  console.log(`Tổng ${rows.length} lock trên bảng users:`);
  rows.forEach(r => {
    console.log(`pid=${r.pid} user=${r.usename} app=${r.application_name} state=${r.state} granted=${r.granted} mode=${r.mode} xact_duration=${r.xact_duration} query="${String(r.query).slice(0,150)}"`);
  });
  await prisma.$disconnect();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
