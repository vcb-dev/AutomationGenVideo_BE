import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_ID = process.env.LARK_REPORT_BASE_ID || 'Q5Fmby8DVaKOyusfR8glgRB6gbf';
const LARK_TABLE_ID = process.env.LARK_REPORT_TABLE_ID || 'tblte3XJWcPvHhxW';
const BASE_URL = 'https://open.larksuite.com/open-apis';

async function main() {
  try {
    const authRes = await axios.post(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
        app_id: LARK_APP_ID,
        app_secret: LARK_APP_SECRET,
    });
    const token = authRes.data.tenant_access_token;

    console.log('Fetching all records from Lark...');
    let allRecords: any[] = [];
    let pageToken = '';
    let hasMore = true;

    while (hasMore) {
        const res = await axios.get(`${BASE_URL}/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { 
                page_size: 500,
                page_token: pageToken || undefined
            }
        });
        const data = res.data.data;
        allRecords = allRecords.concat(data.items || []);
        hasMore = data.has_more;
        pageToken = data.page_token;
    }

    console.log(`Total records: ${allRecords.length}`);
    const noDate = allRecords.filter(r => !r.fields.Date);
    console.log(`Records with no Date field: ${noDate.length}`);
    
    // Print the last 10 no-date records
    console.log('Sample no-date records:');
    console.log(JSON.stringify(noDate.slice(-10), null, 2));

  } catch (e: any) {
    console.error('Error:', e.response?.data || e.message);
  }
}

main();
