import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const LARK_APP_ID = process.env.LARK_APP_ID;
const LARK_APP_SECRET = process.env.LARK_APP_SECRET;

async function run() {
    try {
        console.log('Authenticating to Lark...');
        const authRes = await axios.post(
            'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
            {
                app_id: LARK_APP_ID,
                app_secret: LARK_APP_SECRET,
            }
        );

        const token = authRes.data.tenant_access_token;
        console.log('Token obtained! Fetching records from Channel table...');

        const baseId = 'JAEmwmWQkixHOOkumU5lRU7ogkb';
        const tableId = 'tblWxMtDAkvh1gWS';

        let pageToken = '';
        let hasMore = true;
        let allRecords: any[] = [];

        while (hasMore) {
            const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records`;
            const res = await axios.get(url, {
                headers: { Authorization: `Bearer ${token}` },
                params: {
                    text_field_as_key: true,
                    page_size: 500,
                    ...(pageToken ? { page_token: pageToken } : {}),
                },
            });

            const data = res.data.data;
            if (data.items) {
                allRecords.push(...data.items);
            }
            hasMore = data.has_more;
            pageToken = data.page_token || '';
            console.log(`Fetched chunk. Total accumulated: ${allRecords.length}`);
        }

        console.log('\n=== LARK CHANNEL DATA SEARCH ===');
        
        const matches = allRecords.filter(r => {
            const fieldsJson = JSON.stringify(r.fields).toLowerCase();
            return fieldsJson.includes('cam') || fieldsJson.includes('huyền') || fieldsJson.includes('hcam6192');
        });

        console.log(`Found ${matches.length} records mentioning Cam/Huyền in Lark:`);
        matches.forEach((m, index) => {
            console.log(`\n[Record ${index + 1}] ID: ${m.record_id}`);
            console.log(JSON.stringify(m.fields, null, 2));
        });

    } catch (error: any) {
        console.error('Error occurred:', error?.response?.data || error.message);
    }
}

run();
