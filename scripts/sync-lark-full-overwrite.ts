/**
 * sync-lark-full-overwrite.ts
 *
 * Đồng bộ người dùng từ Lark Base về đồng thời LOCAL và SERVER DB.
 * Ghi đè toàn bộ: Name, Email, Team, Role, Status.
 *
 * Usage:
 *   npx ts-node scripts/sync-lark-full-overwrite.ts
 */

import axios from 'axios';
import { PrismaClient, UserRole } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────
const LARK_APP_ID         = process.env.LARK_APP_ID;
const LARK_APP_SECRET     = process.env.LARK_APP_SECRET;
const LARK_BASE_APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || 'GtOmwYSoUiFpcbkNFpPlG5pKgrh';
const LARK_BASE_TABLE_ID  = process.env.LARK_BASE_TABLE_ID  || 'tblWq1M8sTSXgKmz';
const BASE_URL = 'https://open.larksuite.com/open-apis';

const LOCAL_DB_URL  = process.env.DATABASE_URL;
const SERVER_DB_URL = process.env.SERVER_DATABASE_URL;

// ─── Types ───────────────────────────────────────────────────────────────────
type NormalizedUser = {
  recordId: string;
  email: string;
  fullName: string;
  team: string | null;
  roles: UserRole[];
  employeeStatus: 'ON' | 'OFF';
  isActive: boolean;
  employeeId: string | null;
  imageUrl: string | null;
  employeeData: any | null;
  larkPermissions: any | null;
};

// ─── Lark Helpers ─────────────────────────────────────────────────────────────
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
  console.log(`   → Đã lấy ${all.length} bản ghi thô`);
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

function normalizeRecord(record: any): NormalizedUser | null {
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

// ─── Sync Logic ──────────────────────────────────────────────────────────────
async function syncToDb(dbUrl: string, label: string, users: NormalizedUser[]) {
  console.log(`\n🚀 Đang đồng bộ tới ${label} (Bảng users)...`);
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const emails = users.map(u => u.email);

  try {
    let created = 0, updated = 0;
    for (const row of users) {
      const data = {
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
      };

      const result = await prisma.user.upsert({
        where: { email: row.email },
        update: data,
        create: { email: row.email, ...data },
      });

      const isNew = Math.abs(Date.now() - result.created_at.getTime()) < 5000;
      if (isNew) created++; else updated++;
    }

    // Deactivate những người không còn trên Lark
    const deactivated = await prisma.user.updateMany({
      where: {
        email: { notIn: emails },
        OR: [{ lark_employee_record_id: { not: null } }, { employee_id: { not: null } }],
      },
      data: { employee_status: 'OFF', is_active: false },
    });

    console.log(`   ✅ Hoàn tất ${label}: Tạo mới ${created}, Cập nhật ${updated}, Khóa ${deactivated.count}`);
  } catch (err: any) {
    console.error(`   ❌ Lỗi khi đồng bộ ${label}:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  try {
    const token = await getToken();
    const rawRecords = await fetchAllRecords(token);
    const users = rawRecords.map(normalizeRecord).filter((u): u is NormalizedUser => !!u);

    const uniqueUsers = Array.from(new Map(users.map(u => [u.email, u])).values());
    console.log(`📊 Tổng số người dùng hợp lệ từ Lark: ${uniqueUsers.length}`);

    // Đồng bộ Local
    if (LOCAL_DB_URL) {
      await syncToDb(LOCAL_DB_URL, 'LOCAL DB', uniqueUsers);
    } else {
      console.warn('⚠️  Bỏ qua LOCAL DB (thiếu DATABASE_URL)');
    }

    // Đồng bộ Server
    if (SERVER_DB_URL) {
      await syncToDb(SERVER_DB_URL, 'SERVER DB', uniqueUsers);
    } else {
      console.warn('⚠️  Bỏ qua SERVER DB (thiếu SERVER_DATABASE_URL)');
    }

    console.log('\n✨ Đã hoàn thành đồng bộ toàn bộ hệ thống!');
  } catch (err: any) {
    console.error('❌ Thất bại:', err.message);
  }
}

main();
