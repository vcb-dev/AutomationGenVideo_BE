
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

async function testLarkFetch() {
    const appId = "cli_a9b023ef4078ded0";
    const appSecret = "ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu";
    const baseId = "XJQWbUmkWaJcW8sShyIlLXaTgvb";
    const tableId = "tblOHji4TJMlY11b"; // Employee table

    // Get token
    const tokenRes = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: appId,
        app_secret: appSecret
    });
    const token = tokenRes.data.tenant_access_token;

    // Fetch records
    const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records?text_field_as_key=true&page_size=1`;
    const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
    });

    console.log('--- Raw Lark Record Fields ---');
    console.log(JSON.stringify(res.data.data.items[0].fields, null, 2));
}

testLarkFetch().catch(console.error);
