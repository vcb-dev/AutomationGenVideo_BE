import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ColInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
}

async function main() {
  const cols: ColInfo[] = await prisma.$queryRawUnsafe(`
    SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT LIKE '_prisma%'
    ORDER BY c.table_name, c.ordinal_position
  `);

  const byTable = new Map<string, ColInfo[]>();
  for (const c of cols) {
    if (!byTable.has(c.table_name)) byTable.set(c.table_name, []);
    byTable.get(c.table_name)!.push(c);
  }

  type Row = { table: string; col: string; type: string; empty: number; total: number };
  const results: Row[] = [];

  for (const [table, tableCols] of byTable) {
    // One query per table: COUNT(*) plus non-empty count per column
    const exprs = tableCols.map((c, i) => {
      let inner = `"${c.column_name}"`;
      if (c.data_type === 'text' || c.data_type === 'character varying') {
        inner = `NULLIF("${c.column_name}", '')`;
      } else if (c.data_type === 'ARRAY') {
        inner = `NULLIF(cardinality("${c.column_name}"), 0)`;
      }
      return `COUNT(${inner})::bigint AS c${i}`;
    });
    const sql = `SELECT COUNT(*)::bigint AS total, ${exprs.join(', ')} FROM "${table}"`;
    let row: Record<string, bigint>;
    try {
      const r: Record<string, bigint>[] = await prisma.$queryRawUnsafe(sql);
      row = r[0];
    } catch (e: any) {
      console.error(`Bỏ qua bảng ${table}: ${e.message?.split('\n')[0]}`);
      continue;
    }
    const total = Number(row.total);
    tableCols.forEach((c, i) => {
      const nonEmpty = Number(row[`c${i}`]);
      results.push({ table, col: c.column_name, type: c.data_type, empty: total - nonEmpty, total });
    });
  }

  // Tables overview
  const tables = [...new Set(results.map((r) => r.table))];
  console.log(`Đã quét ${tables.length} bảng.\n`);

  // Report: columns with >= 50% empty, in tables that actually have data
  const flagged = results
    .filter((r) => r.total > 0 && r.empty / r.total >= 0.5)
    .sort((a, b) => b.empty / b.total - a.empty / a.total || b.total - a.total);

  console.log('=== Các cột trống >= 50% (chỉ tính bảng có dữ liệu) ===');
  console.log('Bảng.Cột'.padEnd(60) + 'Trống/Tổng (%)');
  console.log('-'.repeat(85));
  for (const r of flagged) {
    const pct = ((r.empty / r.total) * 100).toFixed(1);
    console.log(`${r.table}.${r.col}`.padEnd(60) + `${r.empty}/${r.total} (${pct}%)`);
  }

  const emptyTables = [...byTable.keys()].filter(
    (t) => results.find((r) => r.table === t)?.total === 0,
  );
  console.log(`\n=== Bảng không có dòng nào (${emptyTables.length}) ===`);
  console.log(emptyTables.join(', ') || '(không có)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
