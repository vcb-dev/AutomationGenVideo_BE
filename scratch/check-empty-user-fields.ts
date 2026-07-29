import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const columns: { column_name: string; data_type: string }[] =
    await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
      ORDER BY ordinal_position
    `);

  const totalRows: { count: bigint }[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS count FROM users`,
  );
  const total = Number(totalRows[0].count);
  console.log(`Tổng số user: ${total}\n`);

  const results: { col: string; type: string; empty: number }[] = [];
  for (const c of columns) {
    let emptyCond = `"${c.column_name}" IS NULL`;
    if (c.data_type === 'text' || c.data_type === 'character varying') {
      emptyCond += ` OR "${c.column_name}" = ''`;
    } else if (c.data_type === 'ARRAY') {
      emptyCond += ` OR cardinality("${c.column_name}") = 0`;
    }
    const r: { count: bigint }[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::bigint AS count FROM users WHERE ${emptyCond}`,
    );
    results.push({ col: c.column_name, type: c.data_type, empty: Number(r[0].count) });
  }

  results.sort((a, b) => b.empty - a.empty);
  console.log('Cột'.padEnd(28) + 'Kiểu'.padEnd(20) + 'Số dòng trống / tổng');
  console.log('-'.repeat(70));
  for (const r of results) {
    const pct = total ? ((r.empty / total) * 100).toFixed(1) : '0';
    console.log(
      r.col.padEnd(28) + r.type.padEnd(20) + `${r.empty}/${total} (${pct}%)`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
