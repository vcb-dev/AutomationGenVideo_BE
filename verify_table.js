const axios = require('axios');

async function run() {
    const APP_ID = 'cli_a9b023ef4078ded0';
    const APP_SECRET = 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
    const BASE_ID = 'XJQWbUmkWaJcW8sShyIlLXaTgvb';
    const TABLE_ID = 'tblWxMtDAkvh1gWS';

    try {
        const tokenRes = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
            app_id: APP_ID,
            app_secret: APP_SECRET
        });
        const token = tokenRes.data.tenant_access_token;

        console.log(`Checking Table: ${TABLE_ID} in Base: ${BASE_ID}`);
        try {
            const res = await axios.get(`https://open.larksuite.com/open-apis/bitable/v1/apps/${BASE_ID}/tables/${TABLE_ID}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log('Table exists!', res.data);
        } catch (e) {
            console.error('Not in KPI base. Error:', e.response?.data?.msg || e.message);
        }

        const REPORT_BASE_ID = 'Q5Fmby8DVaKOyusfR8glgRB6gbf';
        console.log(`Checking Table: ${TABLE_ID} in Base: ${REPORT_BASE_ID}`);
        try {
            const res = await axios.get(`https://open.larksuite.com/open-apis/bitable/v1/apps/${REPORT_BASE_ID}/tables/${TABLE_ID}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log('Table exists!', res.data);
        } catch (e) {
            console.error('Not in Report base. Error:', e.response?.data?.msg || e.message);
        }
    } catch (err) {
        console.error('Root Error:', err.message);
    }
}

run();
