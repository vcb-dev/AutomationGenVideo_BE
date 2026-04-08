import axios from 'axios';
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || 'GtOmwYSoUiFpcbkNFpPlG5pKgrh';
const LARK_BASE_TABLE_ID = process.env.LARK_BASE_TABLE_ID || 'tblWq1M8sTSXgKmz';
const BASE_URL = 'https://open.larksuite.com/open-apis';

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

async function getToken(): Promise<string> {
  console.log('Getting Lark access token...');
  const res = await axios.post(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    app_id: LARK_APP_ID,
    app_secret: LARK_APP_SECRET,
  });
  if (res.data.code !== 0) throw new Error(`Auth failed: ${res.data.msg}`);
  return res.data.tenant_access_token;
}

async function fetchRecords(token: string): Promise<any[]> {
  console.log('Fetching records from Lark Base...');
  const allRecords: any[] = [];
  let pageToken: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const params: any = { page_size: 100 };
    if (pageToken) params.page_token = pageToken;

    const res = await axios.get(
      `${BASE_URL}/bitable/v1/apps/${LARK_BASE_APP_TOKEN}/tables/${LARK_BASE_TABLE_ID}/records`,
      { headers: { Authorization: `Bearer ${token}` }, params }
    );

    if (res.data.code !== 0) throw new Error(`API error: ${res.data.msg} (code: ${res.data.code})`);
    const data = res.data.data;
    if (data.items) allRecords.push(...data.items);
    hasMore = Boolean(data.has_more);
    pageToken = data.page_token;
  }

  console.log(`Fetched ${allRecords.length} records`);
  return allRecords;
}

function extractText(field: any): string | null {
  if (field == null) return null;
  if (typeof field === 'string') return field.trim();
  if (typeof field === 'number' || typeof field === 'boolean') return String(field);
  if (Array.isArray(field)) {
    const joined = field
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item?.text) return String(item.text);
        if (item?.name) return String(item.name);
        if (item?.email) return String(item.email);
        return '';
      })
      .join(' ')
      .trim();
    return joined || null;
  }
  if (typeof field === 'object') {
    if (field.text) return String(field.text).trim();
    if (field.val) return String(field.val).trim();
    if (field.name) return String(field.name).trim();
    if (field.email) return String(field.email).trim();
  }
  return null;
}

function normalizeStatus(raw: string | null): 'ON' | 'OFF' {
  const v = (raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (!v) return 'OFF';
  if (v === 'on' || v === 'active' || v === 'dang hoat dong' || v === 'hoat dong' || v === 'dang lam') return 'ON';
  if (v === 'off' || v === 'inactive' || v === 'da nghi' || v.includes('nghi')) return 'OFF';
  return v.includes('on') ? 'ON' : 'OFF';
}

function mapRoles(larkRole: string | null): UserRole[] {
  const role = (larkRole || '').trim().toLowerCase();
  if (role === 'admin') return [UserRole.ADMIN];
  if (role === 'manager') return [UserRole.MANAGER];
  if (role === 'leader') return [UserRole.LEADER];
  return [UserRole.MEMBER];
}

function pickField(fields: Record<string, any>, candidates: string[]): any {
  for (const key of candidates) {
    if (fields[key] !== undefined && fields[key] !== null) return fields[key];
  }
  return null;
}

function parseEmployeeField(employeeRaw: any): { employeeId: string | null; imageUrl: string | null; employeeData: any | null; email: string | null; name: string | null } {
  if (!employeeRaw) return { employeeId: null, imageUrl: null, employeeData: null, email: null, name: null };
  if (Array.isArray(employeeRaw) && employeeRaw.length > 0) {
    const first = employeeRaw[0];
    return {
      employeeId: first?.id ? String(first.id) : null,
      imageUrl: first?.avatar_url ? String(first.avatar_url) : null,
      employeeData: employeeRaw,
      email: first?.email ? String(first.email) : null,
      name: first?.name ? String(first.name) : null,
    };
  }
  return { employeeId: null, imageUrl: null, employeeData: employeeRaw, email: null, name: null };
}

function normalizeRecord(record: any): NormalizedUser | null {
  const fields = (record?.fields || {}) as Record<string, any>;

  const emailField = pickField(fields, ['Email', 'email']);
  const employeeRaw = pickField(fields, ['Nhân viên', 'Nhan vien', 'Employee']);
  const emp = parseEmployeeField(employeeRaw);
  const email = (extractText(emailField) || emp.email || '').toLowerCase().trim();
  if (!email) return null;

  const fullName =
    extractText(pickField(fields, ['Họ Tên', 'HoTen', 'Name'])) ||
    emp.name ||
    email.split('@')[0];

  const team =
    extractText(pickField(fields, ['Team', 'Phòng ban', 'Phong ban'])) || null;

  const larkRole = extractText(pickField(fields, ['Role', 'Chức vụ', 'Chuc vu']));
  const rawStatus = extractText(pickField(fields, ['Trạng thái', 'Trang Thai', 'Status', 'Trạng Thái']));
  const employeeStatus = normalizeStatus(rawStatus);
  const isActive = employeeStatus === 'ON';

  return {
    recordId: String(record.record_id || ''),
    email,
    fullName: fullName.trim(),
    team,
    roles: mapRoles(larkRole),
    employeeStatus,
    isActive,
    employeeId: emp.employeeId,
    imageUrl: emp.imageUrl,
    employeeData: emp.employeeData,
  };
}

async function main() {
  console.log('Starting FORCE overwrite users from Lark...');
  const token = await getToken();
  const rawRecords = await fetchRecords(token);

  const normalized = rawRecords
    .map(normalizeRecord)
    .filter((x): x is NormalizedUser => Boolean(x));

  const uniqueByEmail = new Map<string, NormalizedUser>();
  for (const row of normalized) uniqueByEmail.set(row.email, row);
  const users = [...uniqueByEmail.values()];
  const larkEmails = users.map((u) => u.email);

  let created = 0;
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findMany({
      where: {
        OR: [
          { email: { in: larkEmails } },
          { lark_employee_record_id: { not: null } },
        ],
      },
      select: { id: true, email: true },
    });

    const existingByEmail = new Map(existing.map((u) => [u.email.toLowerCase(), u]));

    for (const row of users) {
      const found = existingByEmail.get(row.email);
      const data = {
        email: row.email,
        full_name: row.fullName,
        roles: row.roles as any,
        team: row.team,
        employee_status: row.employeeStatus,
        is_active: row.isActive,
        lark_employee_record_id: row.recordId || null,
        employee_id: row.employeeId,
        employee_data: row.employeeData,
        image_url: row.imageUrl,
      };

      if (found) {
        await tx.user.update({
          where: { id: found.id },
          data,
        });
        updated++;
      } else {
        await tx.user.create({
          data: {
            ...data,
            password_hash: null,
          },
        });
        created++;
      }
    }

    const deactivated = await tx.user.updateMany({
      where: {
        email: { notIn: larkEmails },
        OR: [
          { lark_employee_record_id: { not: null } },
          { employee_id: { not: null } },
        ],
      },
      data: {
        employee_status: 'OFF',
        is_active: false,
      },
    });

    await tx.$executeRawUnsafe(`
      UPDATE "users"
      SET "employee_status" = CASE
        WHEN "employee_status" IS NULL THEN NULL
        WHEN UPPER(TRIM("employee_status")) = 'ON' THEN 'ON'
        WHEN UPPER(TRIM("employee_status")) = 'OFF' THEN 'OFF'
        WHEN lower("employee_status") LIKE '%ngh%' THEN 'OFF'
        ELSE CASE WHEN "is_active" = true THEN 'ON' ELSE 'OFF' END
      END
    `);

    console.log(`Deactivated users not present on Lark: ${deactivated.count}`);
  });

  console.log('Sync complete.');
  console.log(`Lark records (unique emails): ${users.length}`);
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
}

main()
  .catch((e) => {
    console.error('Sync failed:', e?.response?.data || e?.message || e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
