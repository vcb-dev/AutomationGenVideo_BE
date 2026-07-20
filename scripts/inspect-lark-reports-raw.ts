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

    console.log('Fetching raw records from Lark...');
    const res = await axios.get(`${BASE_URL}/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { 
            page_size: 10,
            sort: JSON.stringify(["Date DESC"])
        }
    });
    const items = res.data.data.items || [];
    console.log(`Fetched ${items.length} records.`);
    
    for (let i = 0; i < Math.min(items.length, 3); i++) {
        console.log(`--- Record ${i + 1} full structure: ---`);
        console.log(JSON.stringify(items[i], null, 2));
    }
  } catch (e: any) {
    console.error('Error:', e.response?.data || e.message);
  }
}

main();
