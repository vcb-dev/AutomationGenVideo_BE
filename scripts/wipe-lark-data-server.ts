
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const SERVER_DB_URL = process.env.SERVER_DATABASE_URL;

async function main() {
  if (!SERVER_DB_URL) {
    console.error('❌ Thiếu SERVER_DATABASE_URL!');
    process.exit(1);
  }

  const p = new PrismaClient({ datasources: { db: { url: SERVER_DB_URL } } });

  try {
    console.log('⚠️ Đang XÓA DỮ LIỆU raw Lark trên SERVER DB để làm sạch dashboard...');
    
    const kpi = await p.kpi.deleteMany({});
    const kpiDoDa = await p.kpiDoDa.deleteMany({});
    const kpiEditor = await (p as any).kpiDoDaEditor.deleteMany({});
    const reports = await p.checklistReport.deleteMany({});
    const perms = await p.reportPermission.deleteMany({});

    console.log(`✅ Đã dọn dẹp xong:`);
    console.log(`   - kpi: ${kpi.count}`);
    console.log(`   - kpi_do_da: ${kpiDoDa.count}`);
    console.log(`   - kpi_do_da_editor: ${kpiEditor.count}`);
    console.log(`   - checklist_reports: ${reports.count}`);
    console.log(`   - report_permissions: ${perms.count}`);
    
    console.log('\n✨ Server hiện đã sạch dữ liệu raw. Bạn cần chạy lại lệnh Sync KPI/Reports để nạp lại dữ liệu mới nhất.');
  } catch (err: any) {
    console.error('❌ Thất bại:', err.message);
  } finally {
    await p.$disconnect();
  }
}

main();
