
import axios from 'axios';

const APP_ID = "cli_a9b023ef4078ded0";
const APP_SECRET = "ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu";
const BASE_ID = 'XJQWbUmkWaJcW8sShyIlLXaTgvb';
const TABLE_ID = 'tbl0wuaAIPo99wrX';

async function getAccessToken() {
    try {
        const response = await axios.post(
            'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
            { app_id: APP_ID, app_secret: APP_SECRET }
        );
        return response.data.tenant_access_token;
    } catch (error) {
        console.error('Error getting token:', error.response?.data || error.message);
        process.exit(1);
    }
}

async function debugFields() {
    const token = await getAccessToken();
    const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${BASE_ID}/tables/${TABLE_ID}/records`;

    try {
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${token}` },
            params: { text_field_as_key: true, page_size: 1 }
        });

        if (response.data.data.items.length > 0) {
            const fields = response.data.data.items[0].fields;
            console.log('--- RELEVANT FIELDS ---');
            console.log('HoTen:', JSON.stringify(fields['HoTen'], null, 2));
            console.log('Link Avatar:', JSON.stringify(fields['Link Avatar'], null, 2));
            console.log('Team:', JSON.stringify(fields['Team'], null, 2));
            console.log('TrangThai:', JSON.stringify(fields['TrangThai'], null, 2));
            console.log('Checklist keys:', JSON.stringify(Object.keys(fields).filter(k => k.startsWith('Check')), null, 2));
            console.log('Check1:', JSON.stringify(fields['Check1'], null, 2));
        } else {
            console.log('No records found.');
        }
    } catch (error) {
        console.error('Error fetching records:', error.response?.data || error.message);
    }
}

debugFields();
