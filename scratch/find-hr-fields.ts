// Tìm các cột user liệt kê nằm ở DB/bảng nào
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const TARGET_COLS = [
  'start_date_work', 'employment_status', 'full_name_legal', 'employee_code_primary',
  'job_title', 'direct_manager', 'gender', 'hometown_new', 'birth_time',
  'insurance_book_number', 'cccd_photo_link', 'form_submitted_at',
  'confidentiality_agreement', 'manager_text', 'raw_data', 'last_synced_at',
  'manager_block_code', 'team_order_number', 'submitted_on_1', 'division_id',
  'role', 'password_hash', 'custom_permissions', 'lark_permissions',
];

const DBS: { name: string; url: string | undefined }[] = [
  { name: 'DB chính (DATABASE_URL)', url: process.env.DATABASE_URL },
  { name: 'DB server (SERVER_DATABASE_URL)', url: process.env.SERVER_DATABASE_URL },
];

async function main() {
  for (const db of DBS) {
    if (!db.url) continue;
    const prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
    try {
      const rows: { table_name: string; column_name: string }[] = await prisma.$queryRawUnsafe(`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = ANY(ARRAY[${TARGET_COLS.map((c) => `'${c}'`).join(',')}])
        ORDER BY table_name, column_name
      `);
      console.log(`\n=== ${db.name} ===`);
      const byTable = new Map<string, string[]>();
      rows.forEach((r) => {
        if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
        byTable.get(r.table_name)!.push(r.column_name);
      });
      for (const [t, cs] of byTable) console.log(`${t}: ${cs.join(', ')}`);
      if (byTable.size === 0) console.log('(không có cột nào khớp)');
    } catch (e: any) {
      console.log(`${db.name}: LỖI ${e.message?.split('\n')[0]}`);
    } finally {
      await prisma.$disconnect();
    }
  }
}

main();
