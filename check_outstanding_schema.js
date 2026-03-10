const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

async function getLarkTenantAccessToken(appId, appSecret) {
    const response = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: appId,
        app_secret: appSecret
    });
    return response.data.tenant_access_token;
}

async function main() {
    const appId = process.env.LARK_APP_ID;
    const appSecret = process.env.LARK_APP_SECRET;
    const baseId = process.env.LARK_REPORT_BASE_ID;
    const tableId = process.env.LARK_OUTSTANDING_TABLE_ID || 'tbluurIuf2qDCdFr';

    const token = await getLarkTenantAccessToken(appId, appSecret);

    const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/fields`;
    try {
        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        fs.writeFileSync('out_table_fields.json', JSON.stringify(response.data.data.items, null, 2), 'utf8');
    } catch(err) {
        console.error(err?.response?.data || err);
    }
}

main();
