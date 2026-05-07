/**
 * sync-lark-to-server-direct.ts
 *
 * Fetch toàn bộ records từ Lark Base (bảng Users / Nhân viên)
 * rồi ghi đè (upsert) thẳng lên SERVER database — bỏ qua local DB.
 *
 * Usage:
 *   ts-node scripts/sync-lark-to-server-direct.ts
 *
 * Requires env:
 *   SERVER_DATABASE_URL   — PostgreSQL connection string của server
 *   LARK_APP_ID / LARK_APP_SECRET
 *   LARK_BASE_APP_TOKEN   — Base ID (GtOmwYSoUiFpcbkNFpPlG5pKgrh)
 *   LARK_BASE_TABLE_ID    — Table ID (tblWq1M8sTSXgKmz)
 */

import axios from 'axios';
import { PrismaClient, UserRole } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

// ─── Lark config ────────────────────────────────────────────────────────────
const LARK_APP_ID     = process.env.LARK_APP_ID     || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || 'GtOmwYSoUiFpcbkNFpPlG5pKgrh';
const LARK_BASE_TABLE_ID  = process.env.LARK_BASE_TABLE_ID  || 'tblWq1M8sTSXgKmz';
const BASE_URL = 'https://open.larksuite.com/open-apis';

// ─── DB config ───────────────────────────────────────────────────────────────
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

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
};

// ─── Lark helpers ─────────────────────────────────────────────────────────────
async function getToken(): Promise<string> {
  console.log('🔑 Getting Lark access token...');
  const res = await axios.post(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    app_id: LARK_APP_ID,
    app_secret: LARK_APP_SECRET,
  });
  if (res.data.code !== 0) throw new Error(`Lark auth failed: ${res.data.msg}`);
  return res.data.tenant_access_token;
}

async function fetchAllRecords(token: string): Promise<any[]> {
  console.log('📥 Fetching records from Lark Base...');
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

    if (res.data.code !== 0)
      throw new Error(`Lark API error: ${res.data.msg} (code: ${res.data.code})`);

    const data = res.data.data;
    if (data.items) all.push(...data.items);
    hasMore = Boolean(data.has_more);
    pageToken = data.page_token;
  }

  console.log(`   → Fetched ${all.length} raw records`);
  return all;
}

// ─── Field parsing ────────────────────────────────────────────────────────────
function extractText(field: any): string | null {
  if (field == null) return null;
  if (typeof field === 'string') return field.trim();
  if (typeof field === 'number' || typeof field === 'boolean') return String(field);
  if (Array.isArray(field)) {
    const joined = field
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item?.text)  return String(item.text);
        if (item?.name)  return String(item.name);
        if (item?.email) return String(item.email);
        return '';
      })
      .join(', ')
      .trim();
    return joined || null;
  }
  if (typeof field === 'object') {
    if (field.text)  return String(field.text).trim();
    if (field.val)   return String(field.val).trim();
    if (field.name)  return String(field.name).trim();
    if (field.email) return String(field.email).trim();
  }
  return null;
}

function pickField(fields: Record<string, any>, candidates: string[]): any {
  for (const key of candidates) {
    if (fields[key] !== undefined && fields[key] !== null) return fields[key];
  }
  return null;
}

function parseEmployeeField(raw: any): {
  employeeId: string | null;
  imageUrl: string | null;
  employeeData: any | null;
  email: string | null;
  name: string | null;
} {
  if (!raw) return { employeeId: null, imageUrl: null, employeeData: null, email: null, name: null };
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    return {
      employeeId:   first?.id         ? String(first.id)         : null,
      imageUrl:     first?.avatar_url ? String(first.avatar_url) : null,
      employeeData: raw,
      email:        first?.email      ? String(first.email)      : null,
      name:         first?.name       ? String(first.name)       : null,
    };
  }
  return { employeeId: null, imageUrl: null, employeeData: raw, email: null, name: null };
}

function normalizeStatus(raw: string | null): 'ON' | 'OFF' {
  const v = (raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (!v) return 'OFF';
  if (['on', 'active', 'dang hoat dong', 'hoat dong', 'dang lam'].includes(v)) return 'ON';
  if (v === 'off' || v === 'inactive' || v === 'da nghi' || v.includes('nghi')) return 'OFF';
  return v.includes('on') ? 'ON' : 'OFF';
}

function mapRoles(larkRole: string | null): UserRole[] {
  const r = (larkRole || '').trim().toLowerCase();
  if (r === 'admin')   return [UserRole.ADMIN];
  if (r === 'manager') return [UserRole.MANAGER];
  if (r === 'leader')  return [UserRole.LEADER];
  return [UserRole.MEMBER];
}

function normalizeRecord(record: any): NormalizedUser | null {
  const fields = (record?.fields || {}) as Record<string, any>;

  const emailField  = pickField(fields, ['Email', 'email']);
  const employeeRaw = pickField(fields, ['Nhân viên', 'Nhan vien', 'Employee']);
  const emp         = parseEmployeeField(employeeRaw);
  const email       = (extractText(emailField) || emp.email || '').toLowerCase().trim();
  if (!email) return null;

  const fullName =
    extractText(pickField(fields, ['Họ Tên', 'HoTen', 'Name'])) ||
    emp.name ||
    email.split('@')[0];

  const team      = extractText(pickField(fields, ['Team', 'Phòng ban', 'Phong ban'])) || null;
  const larkRole  = extractText(pickField(fields, ['Role', 'Chức vụ', 'Chuc vu']));
  const rawStatus = extractText(pickField(fields, ['Trạng thái', 'Trang Thai', 'Status', 'Trạng Thái']));
  const employeeStatus = normalizeStatus(rawStatus);

  return {
    recordId:       String(record.record_id || ''),
    email,
    fullName:       fullName.trim(),
    team,
    roles:          mapRoles(larkRole),
    employeeStatus,
    isActive:       employeeStatus === 'ON',
    employeeId:     emp.employeeId,
    imageUrl:       emp.imageUrl,
    employeeData:   emp.employeeData,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const serverUrl = requireEnv('SERVER_DATABASE_URL');
  const server = new PrismaClient({ datasources: { db: { url: serverUrl } } });

  console.log('🚀 Starting: Lark → Server DB direct sync');
  console.log('   Table:', LARK_BASE_APP_TOKEN, '/', LARK_BASE_TABLE_ID);

  try {
    // 1. Fetch from Lark
    const token      = await getToken();
    const rawRecords = await fetchAllRecords(token);

    // 2. Normalize & deduplicate by email, filtering for ONLY 'ON' status
    const normalized = rawRecords
      .map(normalizeRecord)
      .filter((x): x is NormalizedUser => x !== null && x.employeeStatus === 'ON');

    const uniqueByEmail = new Map<string, NormalizedUser>();
    for (const row of normalized) uniqueByEmail.set(row.email, row);
    const users = [...uniqueByEmail.values()];
    const larkEmails = users.map((u) => u.email);

    console.log(`📊 Unique valid records: ${users.length}`);

    // 3. Upsert lên server DB
    let created = 0;
    let updated = 0;

    // Xử lý từng record NGOÀI transaction để tránh timeout và dễ recover
    for (const row of users) {
      try {
        // Dọn conflict: nếu lark_employee_record_id này đang gán cho email khác → clear
        if (row.recordId) {
          await server.user.updateMany({
            where: {
              lark_employee_record_id: row.recordId,
              email: { not: row.email },
            },
            data: { lark_employee_record_id: null },
          });
        }

        // Dọn conflict: nếu employee_id này đang gán cho email khác → clear
        if (row.employeeId) {
          await server.user.updateMany({
            where: {
              employee_id: row.employeeId,
              email: { not: row.email },
            },
            data: { employee_id: null },
          });
        }

        // updateData KHÔNG có email (tránh unique constraint khi update)
        const updateData = {
          full_name:                row.fullName,
          roles:                    row.roles as any,
          team:                     row.team,
          employee_status:          row.employeeStatus,
          is_active:                row.isActive,
          lark_employee_record_id:  row.recordId || null,
          employee_id:              row.employeeId,
          employee_data:            row.employeeData,
          image_url:                row.imageUrl,
        };

        const createData = {
          email:          row.email,
          password_hash:  null,
          ...updateData,
        };

        const result = await server.user.upsert({
          where:  { email: row.email },
          update: updateData,
          create: createData,
        });

        // Kiểm tra xem là create hay update (so sánh created_at ≈ now)
        const isNew = Math.abs(Date.now() - result.created_at.getTime()) < 5000;
        if (isNew) created++; else updated++;

      } catch (err: any) {
        console.error(`   ✗ Failed [${row.email}]: ${err?.message}`);
      }

      if ((created + updated) % 50 === 0 && (created + updated) > 0) {
        console.log(`   ↳ Progress: ${created + updated}/${users.length}`);
      }
    }

    // Deactivate users không còn trên Lark (có lark_employee_record_id nhưng không có trong list)
    const deactivated = await server.user.updateMany({
      where: {
        email: { notIn: larkEmails },
        OR: [
          { lark_employee_record_id: { not: null } },
          { employee_id: { not: null } },
        ],
      },
      data: { employee_status: 'OFF', is_active: false },
    });

    // Fix dữ liệu employee_status bị lệch chuẩn
    await server.$executeRawUnsafe(`
      UPDATE "users"
      SET "employee_status" = CASE
        WHEN "employee_status" IS NULL THEN NULL
        WHEN UPPER(TRIM("employee_status")) = 'ON'  THEN 'ON'
        WHEN UPPER(TRIM("employee_status")) = 'OFF' THEN 'OFF'
        WHEN lower("employee_status") LIKE '%ngh%'  THEN 'OFF'
        ELSE CASE WHEN "is_active" = true THEN 'ON' ELSE 'OFF' END
      END
    `);

    console.log(`⚠️  Deactivated (not on Lark): ${deactivated.count}`);

    console.log('');
    console.log('✅ Sync complete!');
    console.log(`   Created : ${created}`);
    console.log(`   Updated : ${updated}`);
    console.log(`   Total   : ${created + updated} / ${users.length}`);
  } finally {
    await server.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌ Sync failed:', e?.response?.data || e?.message || e);
  process.exit(1);
});
