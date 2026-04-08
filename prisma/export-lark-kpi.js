/**
 * Export bảng lark_kpi từ DB local → file SQL (TRUNCATE + INSERT) để import lên Cloud SQL / server.
 *
 * Cách dùng (từ thư mục AutomationGenVideo_BE):
 *   node prisma/export-lark-kpi.js
 *
 * Hoặc chỉ định connection string (ưu tiên hơn biến môi trường):
 *   node prisma/export-lark-kpi.js "postgresql://user:pass@host:5432/dbname?schema=public"
 *
 * Biến môi trường:
 *   DATABASE_URL  — nếu không truyền argv[2]
 *
 * Đầu ra: prisma/lark_kpi_export.sql
 *
 * Sau khi có file: mở Cloud SQL Studio / psql trên server → chạy toàn bộ script (đã TRUNCATE + INSERT).
 * Nên backup bảng lark_kpi trên server trước khi chạy.
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const dbUrl =
  process.argv[2] ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:5432/video_production?schema=public';

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } },
});

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (typeof val === 'bigint') return val.toString();
  if (typeof val === 'object' && val !== null && !Buffer.isBuffer(val)) {
    const s = JSON.stringify(val).replace(/\\/g, '\\\\').replace(/'/g, "''");
    return `'${s}'::jsonb`;
  }
  const s = String(val).replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${s}'`;
}

async function main() {
  console.log('Connecting:', dbUrl.replace(/:[^:@/]+@/, ':****@'));
  const rows = await prisma.$queryRaw`
    SELECT * FROM lark_kpi ORDER BY "report_date" ASC NULLS LAST, "id" ASC
  `;
  console.log(`Found ${rows.length} rows in lark_kpi`);

  if (rows.length === 0) {
    console.log('No data to export.');
    return;
  }

  const columns = Object.keys(rows[0]);
  const colList = columns.map((c) => `"${c}"`).join(', ');

  const lines = [];
  lines.push('-- =====================================================');
  lines.push('-- Export lark_kpi from local (or DATABASE_URL) → import trên server');
  lines.push(`-- Total rows: ${rows.length}`);
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push('-- =====================================================');
  lines.push('');
  lines.push('-- Ghi đè toàn bộ dữ liệu KPI trên server bằng bản export này');
  lines.push('TRUNCATE TABLE "lark_kpi";');
  lines.push('');

  for (const row of rows) {
    const vals = columns.map((c) => esc(row[c])).join(', ');
    lines.push(`INSERT INTO "lark_kpi" (${colList}) VALUES (${vals});`);
  }

  lines.push('');
  lines.push(`-- Done: ${rows.length} rows`);

  const outPath = path.join(__dirname, 'lark_kpi_export.sql');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  const fileSizeKB = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`\nSQL saved to: prisma/lark_kpi_export.sql (${fileSizeKB} KB)`);
  console.log('Tiếp theo: upload file lên Cloud SQL Studio hoặc psql và chạy toàn bộ.');
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
