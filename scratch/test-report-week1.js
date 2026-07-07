const axios = require('axios');

async function main() {
  const baseUrl = 'http://localhost:3000/api';
  const loginRes = await axios.post(`${baseUrl}/auth/login`, {
    email: 'bdcuong@gmail.com',
    password: 'Vienchibao@6688'
  });
  
  const token = loginRes.data.access_token;
  const config = {
    headers: { Authorization: `Bearer ${token}` }
  };
  
  const periodId = '8c3c89f0-6591-4c99-8bff-fc6a99d181ed';
  const team = 'K1';
  console.log(`Calling report data API for team=${team}, periodId=${periodId}`);
  
  const res = await axios.get(`${baseUrl}/content-report/data?team=${team}&periodId=${periodId}`, config);
  console.log('Response members count:', res.data.members?.length);
  console.log('Response members:', res.data.members);
}

main().catch(console.error);
