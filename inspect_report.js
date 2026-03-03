
const APP_ID = 'cli_a9b023ef4078ded0';
const APP_SECRET = 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const TABLE_ID = 'tblte3XJWcPvHhxW';
const BASE_ID = 'Q5Fmby8DVaKOyusfR8glgRB6gbf';

async function run() {
    console.log('Fetching token...');
    const tokenResp = await fetch('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
    });
    const { tenant_access_token: token } = await tokenResp.json();
    console.log('Token fetched.');

    console.log(`Fetching records from table ${TABLE_ID}...`);
    const resp = await fetch(`https://open.larksuite.com/open-apis/bitable/v1/apps/${BASE_ID}/tables/${TABLE_ID}/records?page_size=3`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    if (data.code === 0) {
        console.log(`Found ${data.data.items.length} records.`);
        data.data.items.forEach((item, index) => {
            console.log(`--- Record ${index + 1} (${item.record_id}) ---`);
            console.log('Fields:', JSON.stringify(item.fields, null, 2));
        });
    } else {
        console.error('Lark API Error:', data);
    }
}
run();
