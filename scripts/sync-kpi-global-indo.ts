/**
 * Script sync KPI Global Indo:
 *   - KPI table  (LARK_KPI_GLOBAL_INDO_TABLE_ID)        : target KPI mỗi ngày
 *   - Report table (LARK_KPI_GLOBAL_INDO_REPORT_TABLE_ID): "Bảng Task New (Gói)"
 *       → chỉ đếm records có Duyệt video = "Đã duyệt"  (1 record = 1 video hoàn thành)
 *       → match với KPI table qua Lark open_id (Người[0].id == Nhân viên[0].id)
 *
 * Chạy: npm run sync:kpi:global-indo
 */
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { withRemoteClient, getRemoteDbUrl } from './lib/remote-prisma';

dotenv.config();

const APP_ID       = process.env.LARK_KPI_GLOBAL_INDO_APP_ID!;
const APP_SECRET   = process.env.LARK_KPI_GLOBAL_INDO_APP_SECRET!;
const BASE_ID      = process.env.LARK_KPI_GLOBAL_INDO_BASE_ID!;
const KPI_TABLE    = process.env.LARK_KPI_GLOBAL_INDO_TABLE_ID!;    // tblNGmNglrQ0OLdh
const REPORT_TABLE = process.env.LARK_KPI_GLOBAL_INDO_REPORT_TABLE_ID || ''; // tblckBVgCppYLlXm

const REFRESH_TOKEN_FILE = path.join(__dirname, '../.lark-global-indo-refresh.txt');
const KPI_MIN_DATE = process.env.LARK_KPI_MIN_DATE || `${new Date().getFullYear()}-03-01`;

// ── Token ─────────────────────────────────────────────────────────────────────

async function getUserToken(): Promise<string> {
  let refreshToken = process.env.LARK_KPI_GLOBAL_INDO_REFRESH_TOKEN || '';
  if (fs.existsSync(REFRESH_TOKEN_FILE)) {
    const fromFile = fs.readFileSync(REFRESH_TOKEN_FILE, 'utf-8').trim();
    if (fromFile) refreshToken = fromFile;
  }
  if (!refreshToken) throw new Error('Chưa có refresh_token — chạy: npx ts-node scripts/lark-auth-global-indo.ts');

  const appRes = await axios.post('https://open.larksuite.com/open-apis/auth/v3/app_access_token/internal', {
    app_id: APP_ID, app_secret: APP_SECRET,
  });
  const appToken = appRes.data.app_access_token;

  const res = await axios.post(
    'https://open.larksuite.com/open-apis/authen/v1/refresh_access_token',
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    { headers: { Authorization: `Bearer ${appToken}` } },
  );
  const data = res.data?.data || res.data;
  if (!data?.access_token) throw new Error(`Refresh thất bại: ${JSON.stringify(res.data)}`);
  if (data.refresh_token) fs.writeFileSync(REFRESH_TOKEN_FILE, data.refresh_token, 'utf-8');

  console.log(`  🔑 user_access_token ok (expires ${data.expires_in}s)`);
  return data.access_token as string;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchAll(token: string, tableId: string): Promise<any[]> {
  const records: any[] = [];
  let pageToken = '';
  let hasMore = true;
  while (hasMore) {
    const res: any = await axios.get(
      `https://open.larksuite.com/open-apis/bitable/v1/apps/${BASE_ID}/tables/${tableId}/records`,
      { headers: { Authorization: `Bearer ${token}` }, params: { page_size: 500, page_token: pageToken || undefined } },
    );
    const data = res.data.data;
    if (data?.items) records.push(...data.items);
    hasMore = !!data?.has_more;
    pageToken = data?.page_token || '';
    console.log(`  📥 table=${tableId} fetched ${records.length}...`);
  }
  return records;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const normKey = (s: string) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ');

/** Lấy open_id + name từ person field (array hoặc object) */
function extractPerson(val: any): { id: string | null; name: string } {
  if (!val) return { id: null, name: '' };
  const obj = Array.isArray(val) ? val[0] : val;
  if (!obj) return { id: null, name: '' };
  return { id: obj.id || null, name: obj.name || obj.en_name || '' };
}

const extractStr = (val: any): string | null => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val || null;
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val) && val.length > 0) {
    const f = val[0];
    return f?.name || f?.text || f?.en_name || (typeof f === 'string' ? f : null);
  }
  if (typeof val === 'object') return val.name || val.text || val.en_name || null;
  return String(val);
};

const extractNum = (val: any): number => {
  if (val === null || val === undefined) return 0;
  if (Array.isArray(val)) return val.length > 0 ? extractNum(val[0]) : 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
};

const extractDate = (val: any): Date | null => {
  if (!val) return null;
  const d = typeof val === 'number' ? new Date(val) : new Date(String(val));
  return isNaN(d.getTime()) ? null : d;
};

const toDateKey = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!BASE_ID || !KPI_TABLE) {
    console.error('❌ LARK_KPI_GLOBAL_INDO_BASE_ID hoặc LARK_KPI_GLOBAL_INDO_TABLE_ID chưa cấu hình');
    process.exit(1);
  }
  console.log('🚀 --- GLOBAL INDO KPI SYNC ---');
  console.log(`  Base: ${BASE_ID}`);
  console.log(`  KPI table:    ${KPI_TABLE}`);
  console.log(`  Report table: ${REPORT_TABLE || '(bỏ qua)'}`);
  console.log(`  Min date:     ${KPI_MIN_DATE}`);

  const token = await getUserToken();
  const today = toDateKey(new Date());

  // ── Fetch song song ─────────────────────────────────────────────────────────
  const [kpiRaw, reportRaw] = await Promise.all([
    fetchAll(token, KPI_TABLE),
    REPORT_TABLE ? fetchAll(token, REPORT_TABLE) : Promise.resolve([]),
  ]);
  console.log(`📋 KPI=${kpiRaw.length} records, Report=${reportRaw.length} records`);

  // ── Bước 1: Parse bảng KPI → buckets per person per day ───────────────────
  type Bucket = {
    id: string; openId: string | null; personKey: string;
    name: string; employee_id: string | null; tag: string | null;
    team: string | null; employee_status: string | null;
    employee_data: any; report_date: Date; dateKey: string; month: string;
    kpi_day: number; kpi_month: number;
    task_auto: number; task_creative: number; task_new: number;
    link_image: string | null;
    traffic_month: number | null; target_traffic_month: string | null;
  };
  const buckets = new Map<string, Bucket>();

  for (const rec of kpiRaw) {
    const f = rec.fields || {};

    const reportDate = extractDate(f['Ngày báo cáo']);
    if (!reportDate) continue;
    const dateKey = toDateKey(reportDate);
    if (dateKey < KPI_MIN_DATE || dateKey > today) continue;

    const person = extractPerson(f['Nhân viên']);
    const nameFromTen = extractStr(f['Tên']);
    const name = person.name || nameFromTen || '';
    if (!name || normKey(name) === 'unknown') continue;

    const tag     = extractStr(f['TAG']) || null;
    const empId   = extractStr(f['ID nhân viên']) || tag || null;
    const team    = extractStr(f['Team']) || 'Global - Indo';
    const status  = extractStr(f['Trạng thái']) || null;

    // Key để merge: dùng open_id ưu tiên, fallback sang normKey(name)
    const personKey = person.id || normKey(name);
    const bucketKey = `${personKey}|${dateKey}`;

    const kpiDay      = extractNum(f['KPI Ngày'] ?? f['Số task tự động']);
    const taskAuto    = extractNum(f['Số task tự động']);
    const taskCreative = extractNum(f['Task sáng tạo']);
    const taskNew     = extractNum(f['Task mới']);
    const month       = extractStr(f['Tháng']) || `T${parseInt(dateKey.slice(5, 7), 10)}`;
    const linkImage   = extractStr(f['Link ảnh']) || null;
    const trafficMonth       = extractNum(f['Traffic Tháng']) || null;
    const targetTrafficMonth = extractStr(f['Mục tiêu Traffic tháng']) || null;

    const existing = buckets.get(bucketKey);
    if (existing) {
      existing.kpi_day    += kpiDay;
      existing.task_auto  += taskAuto;
    } else {
      buckets.set(bucketKey, {
        id: `gcindo-${rec.record_id}`,
        openId: person.id,
        personKey,
        name,
        employee_id: empId,
        tag,
        team,
        employee_status: status,
        employee_data: f['Nhân viên'] ? JSON.stringify(f['Nhân viên']) : null,
        report_date: reportDate,
        dateKey,
        month,
        kpi_day: kpiDay,
        kpi_month: 0,
        task_auto: taskAuto,
        task_creative: taskCreative,
        task_new: taskNew,
        link_image: linkImage,
        traffic_month: trafficMonth,
        target_traffic_month: targetTrafficMonth,
      });
    }
  }

  // Tính kpi_month (tổng theo tháng)
  const monthKpiTotals = new Map<string, number>();
  buckets.forEach((b) => {
    const mk = `${b.personKey}|${b.dateKey.slice(0, 7)}`;
    monthKpiTotals.set(mk, (monthKpiTotals.get(mk) || 0) + b.kpi_day);
  });
  buckets.forEach((b) => {
    b.kpi_month = monthKpiTotals.get(`${b.personKey}|${b.dateKey.slice(0, 7)}`) || 0;
  });

  // ── Bước 2: Parse bảng Task New → đếm "Đã duyệt" per person per day ────────
  const completedMap = new Map<string, number>();

  for (const rec of reportRaw) {
    const f = rec.fields || {};

    // Chỉ đếm video đã có link VÀ đã được duyệt
    if (f['Duyệt video'] !== 'Đã duyệt') continue;
    const linkVideo = f['Link Video'];
    const hasLink = linkVideo && (typeof linkVideo === 'string' ? linkVideo.trim() : Array.isArray(linkVideo) ? linkVideo.length > 0 : !!linkVideo);
    if (!hasLink) continue;

    const reportDate = extractDate(f['Ngày']);
    if (!reportDate) continue;
    const dateKey = toDateKey(reportDate);
    if (dateKey < KPI_MIN_DATE || dateKey > today) continue;

    const person = extractPerson(f['Người']);
    if (!person.id && !person.name) continue;
    const personKey = person.id || normKey(person.name);

    const bucketKey = `${personKey}|${dateKey}`;
    completedMap.set(bucketKey, (completedMap.get(bucketKey) || 0) + 1);
  }

  // Tính completed_month
  const monthDoneTotals = new Map<string, number>();
  completedMap.forEach((v, key) => {
    const [personKey, dateKey] = key.split('|');
    const mk = `${personKey}|${dateKey.slice(0, 7)}`;
    monthDoneTotals.set(mk, (monthDoneTotals.get(mk) || 0) + v);
  });

  // ── Bước 3: Merge rows ────────────────────────────────────────────────────
  const rows: any[] = [];
  buckets.forEach((b, key) => {
    const completedDay   = completedMap.get(key) || 0;
    const completedMonth = monthDoneTotals.get(`${b.personKey}|${b.dateKey.slice(0, 7)}`) || 0;
    const kpiiStatus     = b.kpi_day > 0
      ? (completedDay >= b.kpi_day ? 'ĐẠT' : 'CHƯA ĐẠT')
      : null;
    const kpiDayPct = b.kpi_day > 0 ? `${Math.round((completedDay / b.kpi_day) * 100)}%` : '0%';

    rows.push({
      id:                   b.id,
      employee_id:          b.employee_id,
      name:                 b.name,
      tag:                  b.tag,
      team:                 b.team,
      image_url:            null,
      kpi_day:              b.kpi_day,
      kpi_month:            b.kpi_month,
      kpii_status:          kpiiStatus,
      kpi_day_percent:      kpiDayPct,
      completed_day:        completedDay,
      completed_month:      completedMonth,
      task_new:             b.task_new || null,
      task_new_month:       null,
      task_auto:            b.task_auto || null,
      task_auto_month:      null,
      task_creative:        b.task_creative || null,
      content_win_new:      null,
      revenue_month:        null,
      traffic_month:        b.traffic_month,
      target_revenue_month: null,
      target_traffic_month: b.target_traffic_month,
      kpi_progress_month:   b.kpi_month > 0 ? completedMonth / b.kpi_month : null,
      employee_status:      b.employee_status,
      state:                b.employee_status?.toLowerCase() || null,
      employee_data:        b.employee_data,
      report_date:          b.report_date,
      month:                b.month,
      link_image:           b.link_image,
    });
  });

  const doneCount = [...completedMap.values()].reduce((a, b) => a + b, 0);
  console.log(`📊 ${rows.length} rows | KPI buckets=${buckets.size} | completed records=${doneCount} (từ ${reportRaw.filter(r => r.fields['Duyệt video'] === 'Đã duyệt').length} "Đã duyệt")`);

  if (rows.length === 0) {
    console.warn('⚠️  Không có rows nào — kiểm tra KPI_MIN_DATE hoặc cấu hình bảng');
    process.exit(0);
  }

  // ── Bước 4: Ghi vào DB ─────────────────────────────────────────────────────
  await withRemoteClient(getRemoteDbUrl(), async (prisma) => {
    const delegate = (prisma as any).larkKpiGlobalIndo;
    if (!delegate) throw new Error('larkKpiGlobalIndo delegate not found — chạy: npx prisma generate');
    await delegate.deleteMany({});
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await delegate.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
    }
    console.log(`✅ Synced ${rows.length} rows vào lark_kpi_global_indo`);
  });
}

main().catch(err => { console.error('❌ Script failed:', err.message || err); process.exit(1); });
