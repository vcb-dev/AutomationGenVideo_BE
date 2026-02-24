const axios = require('axios');

async function run() {
    const APP_ID = 'cli_a9b023ef4078ded0';
    const APP_SECRET = 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
    const BASE_ID = 'Y5BrbsO4RaGgxGsq2U9liGRXg0f';

    try {
        const tokenRes = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
            app_id: APP_ID,
            app_secret: APP_SECRET
        });
        const token = tokenRes.data.tenant_access_token;

        console.log(`Listing tables in Base: ${BASE_ID}`);
        const res = await axios.get(`https://open.larksuite.com/open-apis/bitable/v1/apps/${BASE_ID}/tables`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const tables = res.data.data.items || [];
        console.log('Tables:', tables.map(t => ({ name: t.name, id: t.table_id })));

        for (const t of tables) {
            console.log(`--- Fields for ${t.name} (${t.table_id}) ---`);
            const fieldsRes = await axios.get(`https://open.larksuite.com/open-apis/bitable/v1/apps/${BASE_ID}/tables/${t.table_id}/fields`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log(fieldsRes.data.data.items.map(f => f.field_name));
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
}

run();
