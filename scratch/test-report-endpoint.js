const axios = require('axios');

async function main() {
  const baseUrl = 'http://localhost:3000/api';
  
  console.log('Logging in...');
  const loginRes = await axios.post(`${baseUrl}/auth/login`, {
    email: 'bdcuong@gmail.com',
    password: 'Vienchibao@6688'
  });
  
  const token = loginRes.data.access_token;
  console.log('Login successful! Token acquired.');
  
  const config = {
    headers: { Authorization: `Bearer ${token}` }
  };
  
  // 1. Get periods
  const periodsRes = await axios.get(`${baseUrl}/content-report/periods`, config);
  const periods = periodsRes.data;
  console.log('Periods:', periods.map(p => ({ id: p.id, label: p.label })));
  
  if (periods.length === 0) return;
  
  const periodId = periods[0].id;
  const team = 'K1';
  console.log(`\nCalling report data API for team=${team}, periodId=${periodId}`);
  
  const res = await axios.get(`${baseUrl}/content-report/data?team=${team}&periodId=${periodId}`, config);
  console.log('Response teamId:', res.data.teamId);
  console.log('Response teamName:', res.data.teamName);
  console.log('Response members count:', res.data.members?.length);
  console.log('Response members:', res.data.members);
}

main().catch(console.error);
