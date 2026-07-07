const axios = require('axios');

async function run() {
  const baseURL = 'http://localhost:3000/api';
  try {
    const loginRes = await axios.post(`${baseURL}/auth/login`, {
      email: 'admin@vietchibao.com',
      password: 'admin123'
    });
    const token = loginRes.data.access_token;
    const headers = { Authorization: `Bearer ${token}` };

    const teamName = 'K1';
    const periodId = '8c3c89f0-6591-4c99-8bff-fc6a99d181ed'; // Tuần 1 - T7/2026
    
    console.log(`Querying data for team=${teamName}, period=${periodId}...`);
    const res = await axios.get(`${baseURL}/content-report/data?team=${teamName}&periodId=${periodId}`, { headers });
    console.log("✅ Success! Response data:", JSON.stringify(res.data, null, 2));
  } catch (err) {
    if (err.response) {
      console.error(`❌ FAILED:`, err.response.data);
    } else {
      console.error(`❌ ERROR:`, err.message);
    }
  }
}

run();
