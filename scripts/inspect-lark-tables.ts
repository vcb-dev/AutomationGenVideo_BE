import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_ID = process.env.LARK_REPORT_BASE_ID || 'Q5Fmby8DVaKOyusfR8glgRB6gbf';
const BASE_URL = 'https://open.larksuite.com/open-apis';

async function main() {
  try {
    const authRes = await axios.post(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
        app_id: LARK_APP_ID,
        app_secret: LARK_APP_SECRET,
    });
    const token = authRes.data.tenant_access_token;

    console.log('Fetching table list from Lark Base:', LARK_BASE_ID);
    const url = `${BASE_URL}/bitable/v1/apps/${LARK_BASE_ID}/tables`;
    const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const tables = res.data?.data?.items || [];
    console.log(`Found ${tables.length} tables:`);
    console.log(JSON.stringify(tables, null, 2));
  } catch (e: any) {
    console.error('Error:', e.response?.data || e.message);
  }
}

main();
