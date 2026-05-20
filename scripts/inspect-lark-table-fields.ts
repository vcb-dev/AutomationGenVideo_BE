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

    console.log('Fetching field list from Lark Bitable...');
    const url = `${BASE_URL}/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/fields`;
    const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const fields = res.data?.data?.items || [];
    console.log(`Found ${fields.length} fields:`);
    console.log(JSON.stringify(fields.map((f: any) => ({ id: f.field_id, name: f.field_name, type: f.type })), null, 2));
  } catch (e: any) {
    console.error('Error:', e.response?.data || e.message);
  }
}

main();
