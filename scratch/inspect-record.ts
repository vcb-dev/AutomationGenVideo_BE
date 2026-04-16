import axios from 'axios';

async function getAccessToken() {
  const response = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: 'cli_a9b023ef4078ded0',
    app_secret: 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu',
  });
  return response.data.tenant_access_token;
}

async function main() {
  const token = await getAccessToken();
  const url = 'https://open.larksuite.com/open-apis/bitable/v1/apps/XJQWbUmkWaJcW8sShyIlLXaTgvb/tables/tblUubDhUoJ9TV7m/records';
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    params: { page_size: 1, text_field_as_key: true }
  });
  console.log(JSON.stringify(response.data.data.items[0], null, 2));
}

main();
