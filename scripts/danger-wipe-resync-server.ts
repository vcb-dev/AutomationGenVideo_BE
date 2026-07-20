
import axios from 'axios';
import { PrismaClient, UserRole } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────
const LARK_APP_ID         = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET     = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || 'GtOmwYSoUiFpcbkNFpPlG5pKgrh';
const LARK_BASE_TABLE_ID  = process.env.LARK_BASE_TABLE_ID  || 'tblWq1M8sTSXgKmz';
const BASE_URL = 'https://open.larksuite.com/open-apis';

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
  console.log('📥 Đang tải dữ liệu từ Lark Base...');
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
    return field.map((item) => item?.text || item?.name || item?.email || String(item)).join(', ').trim() || null;
  }
  if (typeof field === 'object') return (field.text || field.name || field.email || '').trim() || null;
  return String(field);
}

function parseEmployeeField(raw: any) {
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    return {
      id: first?.id ? String(first.id) : null,
      avatar: first?.avatar_url || null,
      email: first?.email || null,
      name: first?.name || null,
      data: raw,
    };
  }
  return { id: null, avatar: null, email: null, name: null, data: raw };
}

function normalizeRecord(record: any) {
  const f = record?.fields || {};
  const employeeRaw = f['Nhân viên'] || f['Nhan vien'] || f['Employee'];
  const emp = parseEmployeeField(employeeRaw);

  const email = (extractText(f['Email'] || f['email']) || emp.email || '').toLowerCase().trim();
  if (!email) return null;

  const fullName = extractText(f['Họ Tên'] || f['Name'] || f['HoTen']) || emp.name || email.split('@')[0];
  const team = extractText(f['Team'] || f['Phòng ban'] || f['Phong ban']);
  const roleStr = extractText(f['Role'] || f['Chức vụ'] || f['Chuc vu']) || '';
  const statusStr = (extractText(f['Trạng thái'] || f['Status'] || f['Trang Thai']) || '').toLowerCase();

  const isOff = statusStr.includes('off') || statusStr.includes('nghỉ') || statusStr.includes('inactive');
  const employeeStatus = isOff ? 'OFF' : 'ON';

  let roles: UserRole[] = [UserRole.MEMBER];
  if (roleStr.toLowerCase().includes('admin')) roles = [UserRole.ADMIN];
  else if (roleStr.toLowerCase().includes('manager')) roles = [UserRole.MANAGER];
  else if (roleStr.toLowerCase().includes('leader')) roles = [UserRole.LEADER];

  return {
    recordId: String(record.record_id || ''),
    email,
    fullName: fullName.trim(),
    team,
    roles,
    employeeStatus,
    isActive: employeeStatus === 'ON',
    employeeId: emp.id,
    imageUrl: emp.avatar,
    employeeData: emp.data,
    larkPermissions: f['Permissions'] ? JSON.parse(f['Permissions']) : null,
  };
}

async function main() {
  if (!SERVER_DB_URL) {
    console.error('❌ Thiếu SERVER_DATABASE_URL trong .env!');
    process.exit(1);
  }

  const prismaServer = new PrismaClient({ datasources: { db: { url: SERVER_DB_URL } } });

  try {
    // 1. Fetch data from Lark
    console.log('📥 Đang tải dữ liệu từ Lark...');
    const token = await getToken();
    const rawRecords = await fetchAllRecords(token);
    const usersToSync = rawRecords.map(normalizeRecord).filter(u => !!u);
    const uniqueUsers = Array.from(new Map(usersToSync.map(u => [u.email, u])).values());

    console.log(`📊 Tổng số người dùng từ Lark: ${uniqueUsers.length}`);

    // 2. DANGEROUS WIPE ON SERVER
    console.log('⚠️ Đang XÓA TOÀN BỘ dữ liệu bảng users trên SERVER DB...');
    
    // Clear self-references first
    await prismaServer.user.updateMany({
      data: { manager_id: null }
    });

    // Delete all users
    const deleteResult = await prismaServer.user.deleteMany({});
    console.log(`✅ Đã xóa ${deleteResult.count} record(s) cũ trên server.`);

    // 3. SYNC FRESH
    console.log('🚀 Đang bắt đầu đồng bộ mới lên Server...');
    let created = 0;
    for (const row of uniqueUsers) {
      await prismaServer.user.create({
        data: {
          email: row.email,
          full_name: row.fullName,
          roles: row.roles,
          team: row.team,
          employee_status: row.employeeStatus,
          is_active: row.isActive,
          lark_employee_record_id: row.recordId,
          employee_id: row.employeeId,
          employee_data: row.employeeData,
          image_url: row.imageUrl,
          lark_permissions: row.larkPermissions,
          password_hash: null, // Reset password
        }
      });
      created++;
      if (created % 10 === 0) console.log(`   → Đã tạo ${created}/${uniqueUsers.length}`);
    }

    console.log(`\n✨ HOÀN THÀNH: Đã xóa toàn bộ và sync mới ${created} người dùng lên Server DB!`);

  } catch (err: any) {
    console.error('❌ Thất bại:', err.message);
  } finally {
    await prismaServer.$disconnect();
  }
}

main();
