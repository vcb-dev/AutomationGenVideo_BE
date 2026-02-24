const axios = require('axios');

async function run() {
    const APP_ID = 'cli_a9b023ef4078ded0';
    const APP_SECRET = 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';

    try {
        const tokenRes = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
            app_id: APP_ID,
            app_secret: APP_SECRET
        });
        const token = tokenRes.data.tenant_access_token;

        // List shared spaces / drive files that are bitables
        console.log('Fetching drive files to find bitables...');
        const driveRes = await axios.get('https://open.larksuite.com/open-apis/drive/v1/files', {
            headers: { Authorization: `Bearer ${token}` },
            params: { page_size: 100 }
        });

        const files = driveRes.data.data.files || [];
        console.log('Files found:', files.map(f => ({ name: f.name, token: f.token, type: f.type })));

        for (const file of files) {
            if (file.type === 'bitable') {
                console.log(`Checking Bitable: ${file.name} (${file.token})`);
                try {
                    const tablesRes = await axios.get(`https://open.larksuite.com/open-apis/bitable/v1/apps/${file.token}/tables`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    const tables = tablesRes.data.data.items || [];
                    console.log(`  Tables in ${file.name}:`, tables.map(t => ({ name: t.name, id: t.table_id })));

                    if (tables.some(t => t.table_id === 'tblWxMtDAkvh1gWS')) {
                        console.log('!!! FOUND TARGET TABLE !!!');
                        const fieldsRes = await axios.get(`https://open.larksuite.com/open-apis/bitable/v1/apps/${file.token}/tables/tblWxMtDAkvh1gWS/fields`, {
                            headers: { Authorization: `Bearer ${token}` }
                        });
                        console.log('Fields:', JSON.stringify(fieldsRes.data, null, 2));
                        return;
                    }
                } catch (e) {
                    console.error(`  Error checking ${file.name}:`, e.message);
                }
            }
        }
    } catch (err) {
        console.error('Error:', err.response?.data || err.message);
    }
}

run();
