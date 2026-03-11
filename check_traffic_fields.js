require('dotenv').config();
const fs = require('fs');

async function getAccessToken() {
    const response = await fetch('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            app_id: process.env.LARK_APP_ID,
            app_secret: process.env.LARK_APP_SECRET,
        })
    });
    const data = await response.json();
    return data.tenant_access_token;
}

async function getTableFields() {
    const token = await getAccessToken();
    const APP_TOKEN = 'XJQWbUmkWaJcW8sShyIlLXaTgvb';
    const TABLE_ID = 'tblsybBYaPKfsqQK';

    try {
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=1`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        fs.writeFileSync('traffic_record.json', JSON.stringify(data.data.items[0].fields, null, 2), 'utf8');
        console.log("Written to traffic_record.json");
    } catch (e) {
        console.error("Error fetching record:", e);
    }
}

getTableFields();
