/**
 * Debug: Xem cấu trúc raw fields từ Lark cho "Huyền Cam" / "Cam Huyền"
 */
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const EMPLOYEE_BASE_ID = 'GtOmwYSoUiFpcbkNFpPlG5pKgrh';
const EMPLOYEE_TABLE_ID = 'tblWq1M8sTSXgKmz';
const KPI_BASE_ID = process.env.LARK_QLTASK_BASE_ID || 'UqgJw2SZOiZsAYk7ciTl11fKgjg';
const KPI_TABLE_ID = process.env.LARK_KPI_TABLE_ID || 'tblh9DeeqDBItrg7';
const BASE_URL = 'https://open.larksuite.com/open-apis';

async function getToken(): Promise<string> {
  const res = await axios.post(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET,
  });
  return res.data.tenant_access_token;
}

async function fetchAllRecords(token: string, baseId: string, tableId: string): Promise<any[]> {
  const all: any[] = [];
  let pageToken: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const params: any = { page_size: 500 };
    if (pageToken) params.page_token = pageToken;
    const res = await axios.get(
      `${BASE_URL}/bitable/v1/apps/${baseId}/tables/${tableId}/records`,
      { headers: { Authorization: `Bearer ${token}` }, params },
    );
    const data = res.data.data;
    if (data.items) all.push(...data.items);
    hasMore = Boolean(data.has_more);
    pageToken = data.page_token;
  }
  return all;
}

async function main() {
  const token = await getToken();

  // 1. Search Employee table
  console.log('=== EMPLOYEE TABLE (Lark) ===');
  const empRecords = await fetchAllRecords(token, EMPLOYEE_BASE_ID, EMPLOYEE_TABLE_ID);
  console.log(`Total employee records: ${empRecords.length}`);
  
  const matchEmp = empRecords.filter(r => {
    const fields = r.fields;
    const json = JSON.stringify(fields).toLowerCase();
    return json.includes('huyền') || json.includes('huyen');
  });

  for (const r of matchEmp) {
    console.log(`\n--- Record ${r.record_id} ---`);
    for (const [key, val] of Object.entries(r.fields)) {
      const json = JSON.stringify(val);
      if (json.toLowerCase().includes('huy') || json.toLowerCase().includes('cam') || 
          key.toLowerCase().includes('tên') || key.toLowerCase().includes('ten') ||
          key.toLowerCase().includes('ho') || key.toLowerCase().includes('name') ||
          key.toLowerCase().includes('team') || key.toLowerCase().includes('email') ||
          key.toLowerCase().includes('nhân') || key.toLowerCase().includes('nhan') ||
          key.toLowerCase().includes('trạng') || key.toLowerCase().includes('trang')) {
        console.log(`  "${key}": ${json}`);
      }
    }
  }

  // 2. Search KPI table for same person
  console.log('\n\n=== KPI TABLE (Lark) ===');
  const kpiRecords = await fetchAllRecords(token, KPI_BASE_ID, KPI_TABLE_ID);
  console.log(`Total KPI records: ${kpiRecords.length}`);
  
  const matchKpi = kpiRecords.filter(r => {
    const json = JSON.stringify(r.fields).toLowerCase();
    return (json.includes('huyền') || json.includes('huyen')) && 
           (json.includes('cam'));
  });

  console.log(`KPI records matching Huyền/Cam: ${matchKpi.length}`);
  for (const r of matchKpi.slice(0, 3)) {
    console.log(`\n--- KPI Record ${r.record_id} ---`);
    for (const [key, val] of Object.entries(r.fields)) {
      console.log(`  "${key}": ${JSON.stringify(val)}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
