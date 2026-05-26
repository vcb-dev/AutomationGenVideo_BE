import axios from 'axios';
import * as dotenv from 'dotenv';
import {
  getRemoteDbUrl,
  isFullReplaceMode,
  replaceTableRows,
  upsertTableRows,
} from './lib/remote-prisma';

dotenv.config();

const fullReplaceAtStart = isFullReplaceMode();
const REMOTE_DB_URL = getRemoteDbUrl(fullReplaceAtStart);

const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_ID = "UqgJw2SZOiZsAYk7ciTl11fKgjg";
const LARK_TABLE_ID = "tblh9DeeqDBItrg7";

const TABLE = 'lark_kpi';
const COLUMNS = `"id","employee_id","name","tag","team","image_url","kpi_day","kpi_month","kpii_status","completed_day","completed_month","task_new","task_new_month","task_auto","task_auto_month","task_creative","revenue_month","traffic_month","report_date","month","state","link_image","created_at","updated_at"`;
const UPDATE_SET = COLUMNS.split(',')
  .filter((c) => c !== '"id"' && c !== '"created_at"' && c !== '"updated_at"')
  .map((c) => `${c}=EXCLUDED.${c}`)
  .join(',');

async function getToken() {
  const res = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET,
  });
  return res.data.tenant_access_token;
}

async function fetchLarkRecords(token: string) {
  const records: any[] = [];
  let pageToken = '';
  let hasMore = true;
  while (hasMore) {
    const res: any = await axios.get(
      `https://open.larksuite.com/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`,
      { headers: { Authorization: `Bearer ${token}` }, params: { page_size: 500, page_token: pageToken } },
    );
    const data = res.data.data;
    if (data.items) records.push(...data.items);
    hasMore = data.has_more;
    pageToken = data.page_token;
    console.log(`📥 Fetched ${records.length} records from Lark...`);
  }
  return records;
}

function esc(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'bigint' || typeof val === 'number') return String(val);
  if (val instanceof Date) return `'${val.toISOString()}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

function parseLarkValue(val: any): any {
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) {
    if (val.length === 0) return null;
    return val[0].name || val[0].text || val[0];
  }
  if (typeof val === 'object') return val.name || val.text || JSON.stringify(val);
  return val;
}

function rowToSql(r: any): string {
  return `(${esc(r.id)},${esc(r.employee_id)},${esc(r.name)},${esc(r.tag)},${esc(r.team)},${esc(r.image_url)},${esc(r.kpi_day)},${esc(r.kpi_month)},${esc(r.kpii_status)},${esc(r.completed_day)},${esc(r.completed_month)},${esc(r.task_new)},${esc(r.task_new_month)},${esc(r.task_auto)},${esc(r.task_auto_month)},${esc(r.task_creative)},${esc(r.revenue_month)},${esc(r.traffic_month)},${esc(r.report_date)},${esc(r.month)},${esc(r.state)},${esc(r.link_image)},NOW(),NOW())`;
}

async function main() {
  const fullReplace = isFullReplaceMode();
  console.log(`🚀 --- FAST SYNC KPI (${fullReplace ? 'REPLACE: TRUNCATE+INSERT' : 'INCREMENTAL: UPSERT'}) ---`);

  const token = await getToken();
  const rawRecords = await fetchLarkRecords(token);
  const minDate = new Date('2026-03-01T00:00:00Z');

  const kpiData = rawRecords.map((r) => {
    const f = r.fields;
    let rd = null;
    if (f['Ngày báo cáo']) rd = new Date(parseInt(f['Ngày báo cáo']));

    return {
      id: r.record_id,
      employee_id: parseLarkValue(f['ID nhân viên']),
      name: parseLarkValue(f['Nhân viên'] || f['Tên']),
      tag: parseLarkValue(f['TAG']),
      team: parseLarkValue(f['Team']),
      image_url: f['Hình ảnh']?.[0]?.url,
      kpi_day: parseInt(f['KPI Ngày']) || 0,
      kpi_month: parseInt(f['KPI THÁNG']) || 0,
      kpii_status: parseLarkValue(f['KPII']),
      completed_day: parseInt(f['Hoàn thành']) || 0,
      completed_month: parseInt(f['Hoàn thành Tháng']) || 0,
      task_new: parseInt(f['Task mới']) || 0,
      task_new_month: parseInt(f['Task mới tháng']) || 0,
      task_auto: parseInt(f['Task Auto']) || 0,
      task_auto_month: parseInt(f['Task Auto Tháng']) || 0,
      task_creative: parseInt(f['Task sáng tạo']) || 0,
      revenue_month: BigInt(Math.floor(f['Doanh thu tháng'] || 0)),
      traffic_month: BigInt(Math.floor(f['Traffic Tháng'] || 0)),
      report_date: rd,
      month: parseLarkValue(f['Tháng']),
      state: parseLarkValue(f['Trạng thái']),
      link_image: f['Link ảnh'],
    };
  }).filter((row) => {
    if (!row.report_date || row.report_date < minDate) return false;
    const t = (row.team || '').toLowerCase();
    return !(t.includes('đồ da') || t.includes('do da'));
  });

  // Dedupe by Lark record id (avoid 23505 if source has duplicates)
  const seen = new Set<string>();
  const uniqueKpiData = kpiData.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });

  console.log(`📊 Data ready: ${uniqueKpiData.length} records (${kpiData.length - uniqueKpiData.length} dupes dropped).`);

  try {
    console.log(`🔗 Writing to Supabase...`);

    const onProgress = (loaded: number, total: number) =>
      console.log(`   → Inserted ${loaded}/${total}`);

    if (fullReplace) {
      console.log('🗑️  TRUNCATE + INSERT per chunk (no buffer, no UPSERT)...');
      await replaceTableRows(REMOTE_DB_URL, TABLE, COLUMNS, rowToSql, uniqueKpiData, 50, onProgress);
    } else {
      console.log('🔄 Batched UPSERT (incremental)...');
      await upsertTableRows(
        REMOTE_DB_URL, TABLE, COLUMNS, 'id', rowToSql, uniqueKpiData, `${UPDATE_SET}, "updated_at"=NOW()`, 50, onProgress,
      );
    }

    console.log('✅ SYNC SUCCESSFUL!');
  } catch (err) {
    console.error('❌ Sync failed:', err);
    process.exit(1);
  }
}

main();
