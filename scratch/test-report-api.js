const axios = require('axios');

async function main() {
  // 1. Get periods
  const periodsRes = await axios.get('http://localhost:3000/content-report/periods');
  const periods = periodsRes.data;
  console.log('Periods:', periods.map(p => ({ id: p.id, label: p.label })));

  if (periods.length === 0) {
    console.log('No periods found!');
    return;
  }

  const periodId = periods[0].id;
  const team = 'K1';
  console.log(`\nCalling report data API for team=${team}, periodId=${periodId}`);
  
  const res = await axios.get(`http://localhost:3000/content-report/data?team=${team}&periodId=${periodId}`);
  console.log('Response members:', res.data.members);
  console.log('Response teamName:', res.data.teamName);
}

main().catch(console.error);
