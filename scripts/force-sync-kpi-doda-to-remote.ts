import axios from 'axios';
import * as dotenv from 'dotenv';
import { deleteTableInBatches, getRemoteDbUrl, isFullReplaceMode, shouldSkipTableClear, withRemoteClient } from './lib/remote-prisma';

dotenv.config();

const fullReplaceAtStart = isFullReplaceMode();
const REMOTE_DB_URL = getRemoteDbUrl(fullReplaceAtStart);

const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_ID = process.env.LARK_KPI_DODA_BASE_ID || "Livew1AE0i2vo5kF3YXlCPNWg8f";
const LARK_TABLE_ID = process.env.LARK_KPI_DODA_TABLE_ID || "tblPIc4EQjd2wfAa";

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
    console.log(`📥 Fetched ${records.length} records from Lark (Đồ Da)...`);
  }
  return records;
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

async function main() {
  const fullReplace = isFullReplaceMode();
  const skipTruncate = shouldSkipTableClear();

  console.log(`🚀 --- ĐỒ DA EDITOR KPI (${fullReplace ? 'REPLACE' : 'UPSERT'}) ---`);

  const token = await getToken();
  const rawRecords = await fetchLarkRecords(token);

  const stats: Record<string, any> = {};

  for (const r of rawRecords) {
    const f = r.fields;
    const editor = parseLarkValue(f['Người edit']) || 'Unknown';
    const dateRaw = f['Ngày edit'];
    if (!dateRaw || editor === 'Unknown') continue;

    const date = new Date(parseInt(dateRaw));
    const dateKey = date.toISOString().split('T')[0];
    const key = `${editor}_${dateKey}`;

    if (!stats[key]) {
      stats[key] = {
        id: key,
        editor_name: editor,
        report_date: new Date(dateKey),
        report_date_key: dateKey,
        completed_day: 0,
        month: parseLarkValue(f['Tháng']) || `${date.getMonth() + 1}/${date.getFullYear()}`,
      };
    }

    const isDone = f['Đã edit'] === true || f['Đã edit'] === 1 ||
      String(f['Trạng thái']).includes('Hoàn thành') ||
      String(f['Đã edit']).toLowerCase() === 'true';

    if (isDone) stats[key].completed_day += 1;
  }

  const finalData = Object.values(stats);
  console.log(`📊 Aggregated Data: ${finalData.length} editor-day records.`);

  if (fullReplace && !skipTruncate) {
    console.log('🗑️  Clearing lark_kpi_do_da_editor (batched DELETE)...');
    const removed = await deleteTableInBatches(REMOTE_DB_URL, 'lark_kpi_do_da_editor', 200, (n) =>
      console.log(`   → deleted ${n} rows`),
    );
    console.log(`🗑️  Cleared lark_kpi_do_da_editor (${removed} rows)`);
  } else if (fullReplace && skipTruncate) {
    console.log('⏭️  Skip clear lark_kpi_do_da_editor (SYNC_SKIP_TRUNCATE=1)');
  }

  try {
    console.log('🔗 Writing to Supabase (10 rows/batch + retry)...');

    const CHUNK = 10;
    for (let i = 0; i < finalData.length; i += CHUNK) {
      const chunk = finalData.slice(i, i + CHUNK);
      const data = chunk.map((r) => ({
        id: r.id,
        editor_name: r.editor_name,
        report_date: r.report_date,
        report_date_key: r.report_date_key,
        month: r.month,
        completed_day: r.completed_day,
      }));

      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await withRemoteClient(REMOTE_DB_URL, async (prisma) => {
            if (fullReplace) {
              await prisma.larkKpiDoDaEditor.createMany({ data });
            } else {
              for (const row of data) {
                await prisma.larkKpiDoDaEditor.upsert({
                  where: { id: row.id },
                  create: row,
                  update: { completed_day: row.completed_day, month: row.month },
                });
              }
            }
          });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(`   ⚠️  Batch ${i}-${i + chunk.length} attempt ${attempt}/3 failed, retrying...`);
          await new Promise((r) => setTimeout(r, 3000 * attempt));
        }
      }
      if (lastErr) throw lastErr;

      console.log(`   → Inserted ${Math.min(i + CHUNK, finalData.length)}/${finalData.length}`);
    }

    console.log('✅ ĐỒ DA EDITOR SYNC SUCCESSFUL!');
  } catch (err) {
    console.error('❌ Đồ Da Editor Sync failed:', err);
    process.exit(1);
  }
}

main();
