import axios from 'axios';

const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_ID = "UqgJw2SZOiZsAYk7ciTl11fKgjg";
const LARK_TABLE_ID = "tblh9DeeqDBItrg7";

async function getToken() {
    const res = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: LARK_APP_ID,
        app_secret: LARK_APP_SECRET
    });
    return res.data.tenant_access_token;
}

async function main() {
    const token = await getToken();
    const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`;
    const res: any = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        params: { page_size: 1 }
    });
    console.log(JSON.stringify(res.data.data.items[0], null, 2));
}

main();
