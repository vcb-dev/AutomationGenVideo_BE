const axios = require('axios');

const APP_ID = 'cli_a9b023ef4078ded0';
const APP_SECRET = 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';

async function run() {
    try {
        const tokenRes = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
            app_id: APP_ID,
            app_secret: APP_SECRET
        });
        const token = tokenRes.data.tenant_access_token;

        console.log('Listing all bitable apps...');
        const res = await axios.get(`https://open.larksuite.com/open-apis/bitable/v1/apps`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const apps = res.data.data.items || [];
        console.log('Apps found:', apps.map(a => ({ name: a.name, id: a.app_token })));

        for (const app of apps) {
            const baseId = app.app_token;
            console.log('--- Checking app:', app.name, '(', baseId, ') ---');
            try {
                const tablesRes = await axios.get(`https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const tables = tablesRes.data.data.items || [];
                console.log('Tables:', tables.map(t => t.table_id));

                const match = tables.find(t => t.table_id === 'tblWxMtDAkvh1gWS');
                if (match) {
                    console.log('!!! FOUND MATCH !!! in app:', app.name);
                    const fieldsRes = await axios.get(`https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${match.table_id}/fields`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    console.log('Fields:', JSON.stringify(fieldsRes.data, null, 2));
                    return;
                }
            } catch (e) {
                console.error('Error for app', app.name, ':', e.response?.data || e.message);
            }
        }
    } catch (err) {
        console.error('Root Error:', err.message);
    }
}

run();
