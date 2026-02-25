import axios from 'axios';

const LARK_APP_ID = 'cli_a917e6e937f89e19';
const LARK_APP_SECRET = 'KaKQJ48T6ks9qwUwZvJYZfkxf1I5pfwe';
const WIKI_TOKEN = 'GtOmwYSoUiFpcbkNFpPlG5pKgrh';
const TABLE_ID = 'tblWq1M8sTSXgKmz';
const BASE_URL = 'https://open.larksuite.com/open-apis';

async function main() {
    // Get token
    const authRes = await axios.post(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
        app_id: LARK_APP_ID,
        app_secret: LARK_APP_SECRET,
    });
    const token = authRes.data.tenant_access_token;
    console.log('✅ Token obtained\n');

    const headers = { Authorization: `Bearer ${token}` };

    // Try wiki v2 - get node to find obj_token
    console.log('--- Test 1: Wiki V2 get_node (POST body) ---');
    try {
        const res = await axios.post(`${BASE_URL}/wiki/v2/spaces/get_node`, { token: WIKI_TOKEN }, { headers });
        console.log('OK:', JSON.stringify(res.data, null, 2));
    } catch (e: any) { console.log('ERR:', e.response?.status, e.response?.data?.msg || e.message); }

    // Try wiki v2 - get_node with query param
    console.log('\n--- Test 2: Wiki V2 get_node (query param) ---');
    try {
        const res = await axios.get(`${BASE_URL}/wiki/v2/spaces/get_node?token=${WIKI_TOKEN}`, { headers });
        console.log('OK:', JSON.stringify(res.data, null, 2));
    } catch (e: any) { console.log('ERR:', e.response?.status, e.response?.data?.msg || e.message); }

    // Try doc meta
    console.log('\n--- Test 3: Drive doc_meta ---');
    try {
        const res = await axios.get(`${BASE_URL}/drive/v1/metas/batch_query`, {
            headers,
            params: { request_docs: JSON.stringify([{ doc_token: WIKI_TOKEN, doc_type: 'wiki' }]) },
        });
        console.log('OK:', JSON.stringify(res.data, null, 2));
    } catch (e: any) { console.log('ERR:', e.response?.status, e.response?.data?.msg || e.message); }

    // Try POST batch_query
    console.log('\n--- Test 4: Drive meta batch_query POST ---');
    try {
        const res = await axios.post(`${BASE_URL}/drive/v1/metas/batch_query`, {
            request_docs: [
                { doc_token: WIKI_TOKEN, doc_type: 'wiki' },
                { doc_token: WIKI_TOKEN, doc_type: 'bitable' },
            ]
        }, { headers });
        console.log('OK:', JSON.stringify(res.data, null, 2));
    } catch (e: any) { console.log('ERR:', e.response?.status, JSON.stringify(e.response?.data, null, 2)); }

    // Try listing wiki spaces
    console.log('\n--- Test 5: List wiki spaces ---');
    try {
        const res = await axios.get(`${BASE_URL}/wiki/v2/spaces`, { headers, params: { page_size: 5 } });
        console.log('OK:', JSON.stringify(res.data, null, 2));
    } catch (e: any) { console.log('ERR:', e.response?.status, e.response?.data?.msg || e.message); }
}

main().catch(e => console.error('Fatal:', e.message));
