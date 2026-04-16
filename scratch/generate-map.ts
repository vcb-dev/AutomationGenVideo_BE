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
  const baseId = 'XJQWbUmkWaJcW8sShyIlLXaTgvb';
  const tableId = 'tblOHji4TJMlY11b'; // Nhân viên
  const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/fields`;
  const response = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
  const teamField = response.data.data.items.find(f => f.field_name === 'Team' || f.field_name === 'TEAM' || f.field_name === 'BỘ PHẬN');
  
  const map = {};
  teamField.property.options.forEach(opt => {
    if (opt.name) map[opt.id] = opt.name;
  });
  console.log(JSON.stringify(map, null, 2));
}

main();
