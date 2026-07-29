
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────
const LARK_APP_ID         = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET     = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || 'GtOmwYSoUiFpcbkNFpPlG5pKgrh';
const LARK_BASE_TABLE_ID  = process.env.LARK_BASE_TABLE_ID  || 'tblWq1M8sTSXgKmz';
const BASE_URL = 'https://open.larksuite.com/open-apis';

const LOCAL_DB_URL  = process.env.DATABASE_URL;
const SERVER_DB_URL = process.env.SERVER_DATABASE_URL;

async function getToken(): Promise<string> {
  const res = await axios.post(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    app_id: LARK_APP_ID,
    app_secret: LARK_APP_SECRET,
  });
  if (res.data.code !== 0) throw new Error(`Lark auth failed: ${res.data.msg}`);
  return res.data.tenant_access_token;
}

async function fetchAllRecords(token: string): Promise<any[]> {
  console.log('📥 Đang tải dữ liệu từ Lark Base (Permissions)...');
  const all: any[] = [];
  let pageToken: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const params: any = { page_size: 100 };
    if (pageToken) params.page_token = pageToken;
    const res = await axios.get(
      `${BASE_URL}/bitable/v1/apps/${LARK_BASE_APP_TOKEN}/tables/${LARK_BASE_TABLE_ID}/records`,
      { headers: { Authorization: `Bearer ${token}` }, params },
    );
    if (res.data.code !== 0) throw new Error(`Lark API error: ${res.data.msg}`);
    const data = res.data.data;
    if (data.items) all.push(...data.items);
    hasMore = Boolean(data.has_more);
    pageToken = data.page_token;
  }
  return all;
}

function extractText(field: any): string | null {
  if (field == null) return null;
  if (typeof field === 'string') return field.trim();
  if (Array.isArray(field)) {
    return field.map((item) => item?.text || item?.name || item?.email || String(item)).join(' ').trim() || null;
  }
  if (typeof field === 'object') return (field.text || field.name || field.email || '').trim() || null;
  return String(field);
}

async function syncPermissionsToDb(dbUrl: string, label: string, records: any[]) {
  console.log(`\n🚀 Đang đồng bộ report_permissions tới ${label}...`);
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    let created = 0, updated = 0;
    
    // Clear existing to ensure "Ghi đè"
    await prisma.reportPermission.deleteMany({});
    
    for (const record of records) {
      const f = record.fields;
      const email = extractText(f['Email'] || f['email']);
      const name = extractText(f['Họ Tên'] || f['Name'] || f['HoTen']);
      const roleStr = extractText(f['Role'] || f['Chức vụ'] || f['Chuc vu']);
      const team = extractText(f['Team'] || f['Phòng ban'] || f['Phong ban']);
      const status = extractText(f['Trạng thái'] || f['Status'] || f['Trang Thai']);
      const maPin = extractText(f['MaPin'] || f['Mã Pin'] || f['Mã pin']);

      await prisma.reportPermission.create({
        data: {
          id: record.record_id,
          email,
          name,
          role: roleStr,
          team,
          status,
          pin_code: maPin,
          employee: f['Nhân viên'] || f['Nhan vien'] || f['Employee'],
        }
      });
      created++;
    }
    console.log(`   ✅ Hoàn tất ${label}: Đã nạp ${created} bản ghi vào report_permissions`);
  } catch (err: any) {
    console.error(`   ❌ Lỗi khi đồng bộ ${label}:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  try {
    const token = await getToken();
    const rawRecords = await fetchAllRecords(token);

    if (LOCAL_DB_URL) {
      await syncPermissionsToDb(LOCAL_DB_URL, 'LOCAL DB', rawRecords);
    }
    if (SERVER_DB_URL) {
      await syncPermissionsToDb(SERVER_DB_URL, 'SERVER DB', rawRecords);
    }
    console.log('\n✨ Đã hoàn thành đồng bộ report_permissions!');
  } catch (err: any) {
    console.error('❌ Thất bại:', err.message);
  }
}

main();
