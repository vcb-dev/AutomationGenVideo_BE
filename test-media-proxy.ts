
import axios from 'axios';

async function testMediaDownload() {
    const appId = "cli_a9b023ef4078ded0";
    const appSecret = "ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu";
    const mediaId = "PXHPbgsbbokNdcx8iwHlWknzgve"; // Nguyen Tuan's media token

    // Get token
    const tokenRes = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: appId,
        app_secret: appSecret
    });
    const token = tokenRes.data.tenant_access_token;

    // Try download WITHOUT extra
    const urlNoExtra = `https://open.larksuite.com/open-apis/drive/v1/medias/${mediaId}/download`;
    try {
        const res = await axios.get(urlNoExtra, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Download WITHOUT extra: SUCCESS');
    } catch (err) {
        console.log('Download WITHOUT extra: FAILED', err.response?.data || err.message);
    }

    // Try download WITH extra (from my previous debug output)
    const extra = "%7B%22bitablePerm%22%3A%7B%22tableId%22%3A%22tblOHji4TJMlY11b%22%2C%22rev%22%3A1772%7D%7D";
    const urlWithExtra = `${urlNoExtra}?extra=${extra}`;
    try {
        const res = await axios.get(urlWithExtra, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Download WITH extra: SUCCESS');
    } catch (err) {
        console.log('Download WITH extra: FAILED', err.response?.data || err.message);
    }
}

testMediaDownload().catch(console.error);
