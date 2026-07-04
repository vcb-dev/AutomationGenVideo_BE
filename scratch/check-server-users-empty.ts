import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.SERVER_DATABASE_URL } },
});

async function main() {
  const columns: { column_name: string; data_type: string }[] = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
    ORDER BY ordinal_position
  `);
  const total = Number(
    ((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS c FROM users`)) as any)[0].c,
  );
  console.log(`DB server — bảng users: ${total} dòng, ${columns.length} cột\n`);

  const results: { col: string; empty: number }[] = [];
  for (const c of columns) {
    let cond = `"${c.column_name}" IS NULL`;
    if (c.data_type === 'text' || c.data_type === 'character varying') cond += ` OR "${c.column_name}" = ''`;
    else if (c.data_type === 'ARRAY') cond += ` OR cardinality("${c.column_name}") = 0`;
    const r: any = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::bigint AS c FROM users WHERE ${cond}`,
    );
    results.push({ col: c.column_name, empty: Number(r[0].c) });
  }
  results.sort((a, b) => b.empty - a.empty);
  for (const r of results) {
    const pct = total ? ((r.empty / total) * 100).toFixed(1) : '0';
    console.log(r.col.padEnd(32) + `${r.empty}/${total} (${pct}%)`);
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
