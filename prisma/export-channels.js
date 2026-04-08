/**
 * Script export bảng huyk_channels từ local DB ra file SQL.
 * Chạy từ thư mục AutomationGenVideo_BE:
 *   node prisma/export-channels.js
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:5432/video_production?schema=public' } }
});

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  if (val instanceof Date) return `'${val.toISOString()}'`;
  const s = String(val).replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${s}'`;
}

async function main() {
  console.log('Connecting to local DB...');
  const rows = await prisma.$queryRaw`SELECT * FROM huyk_channels ORDER BY created_at`;
  console.log(`Found ${rows.length} rows in huyk_channels`);

  if (rows.length === 0) {
    console.log('No data to export.');
    return;
  }

  const columns = Object.keys(rows[0]);
  const colList = columns.map(c => `"${c}"`).join(', ');

  const lines = [];
  lines.push('-- =====================================================');
  lines.push('-- Export huyk_channels from local DB → paste vào Cloud SQL Studio');
  lines.push(`-- Total rows: ${rows.length}`);
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push('-- =====================================================');
  lines.push('');
  lines.push('-- Đảm bảo cột email tồn tại trước');
  lines.push('ALTER TABLE "huyk_channels" ADD COLUMN IF NOT EXISTS "email" TEXT;');
  lines.push('');
  lines.push('-- Xóa dữ liệu cũ, giữ lại cấu trúc bảng');
  lines.push('TRUNCATE TABLE "huyk_channels";');
  lines.push('');

  for (const row of rows) {
    const vals = columns.map(c => esc(row[c])).join(', ');
    lines.push(`INSERT INTO "huyk_channels" (${colList}) VALUES (${vals});`);
  }

  lines.push('');
  lines.push(`-- Done: ${rows.length} rows`);

  const outPath = path.join(__dirname, 'huyk_channels_export.sql');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  const fileSizeKB = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`\nSQL saved to: prisma/huyk_channels_export.sql (${fileSizeKB} KB)`);
  console.log('Bước tiếp: mở Cloud SQL Studio → paste nội dung file → Run');
}

main()
  .catch(err => { console.error('Error:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
