const axios = require('axios');

async function run() {
    const APP_ID = 'cli_a9b023ef4078ded0';
    const APP_SECRET = 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
    const BASE_ID = 'Y5BrbsO4RaGgxGsq2U9liGRXg0f';
    const TABLE_ID = 'tblWxMtDAkvh1gWS';

    try {
        const tokenRes = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
            app_id: APP_ID,
            app_secret: APP_SECRET
        });
        const token = tokenRes.data.tenant_access_token;

        console.log(`Connecting to Base: ${BASE_ID}, Table: ${TABLE_ID}`);
        try {
            const res = await axios.get(`https://open.larksuite.com/open-apis/bitable/v1/apps/${BASE_ID}/tables/${TABLE_ID}/records`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { page_size: 20 }
            });
            console.log('Success! Count:', res.data.data.items?.length);
            console.log('Sample record fields:', res.data.data.items?.[0]?.fields);
        } catch (e) {
            console.error('Error Details:', JSON.stringify(e.response?.data, null, 2));
        }
    } catch (err) {
        console.error('Root Error:', err.message);
    }
}

run();
