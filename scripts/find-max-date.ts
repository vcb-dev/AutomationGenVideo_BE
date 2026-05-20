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
        console.log(`Fetched page. Current total: ${allRecords.length}`);
        if (allRecords.length > 5000) break;
    }

    console.log(`Total records fetched: ${allRecords.length}`);
    
    // Find min, max dates and count
    let countWithDate = 0;
    let maxDate = 0;
    let minDate = Infinity;
    const dateCounts: { [key: string]: number } = {};

    for (const r of allRecords) {
        const d = r.fields.Date;
        if (d) {
            countWithDate++;
            if (d > maxDate) maxDate = d;
            if (d < minDate) minDate = d;
            
            const dateStr = new Date(d).toISOString().split('T')[0];
            dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
        }
    }

    console.log(`Records with Date field: ${countWithDate}`);
    console.log(`Min Date: ${minDate === Infinity ? 'N/A' : new Date(minDate).toISOString()}`);
    console.log(`Max Date: ${maxDate === 0 ? 'N/A' : new Date(maxDate).toISOString()}`);
    console.log('Date distribution (last 15 days):');
    const sortedDates = Object.keys(dateCounts).sort().reverse();
    for (const d of sortedDates.slice(0, 15)) {
        console.log(`- ${d}: ${dateCounts[d]} records`);
    }

  } catch (e: any) {
    console.error('Error:', e.response?.data || e.message);
  }
}

main();
