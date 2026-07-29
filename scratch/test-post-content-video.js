const axios = require('axios');

async function run() {
  const baseURL = 'http://localhost:3000/api';
  try {
    console.log("Logging in as admin...");
    const loginRes = await axios.post(`${baseURL}/auth/login`, {
      email: 'admin@vietchibao.com',
      password: 'admin123'
    });
    const token = loginRes.data.access_token;
    console.log(`✅ Login successful. Token: ${token.substring(0, 15)}...`);

    const headers = { Authorization: `Bearer ${token}` };

    // Get teams
    console.log("Fetching teams...");
    const teamsRes = await axios.get(`${baseURL}/content-report/teams`, { headers });
    const team = teamsRes.data[0];
    console.log(`Found team: ${team.name} (ID: ${team.id})`);

    // Get periods
    console.log("Fetching periods...");
    const periodsRes = await axios.get(`${baseURL}/content-report/periods`, { headers });
    const period = periodsRes.data[0];
    console.log(`Found period: ${period.label} (ID: ${period.id})`);

    const payload = {
      team_id: team.id,
      period_id: period.id,
      status: 'WIN',
      content: 'Test content win video',
      analysis: 'Test reason win',
      editor: 'Default Admin',
      post_date: new Date().toISOString().split('T')[0],
      platform: 'TikTok'
    };

    console.log("Sending POST to /content-report/content-videos with payload:", payload);
    const postRes = await axios.post(`${baseURL}/content-report/content-videos`, payload, { headers });
    console.log("✅ Success! Response:", postRes.data);
  } catch (err) {
    if (err.response) {
      console.error(`❌ FAILED with status ${err.response.status}:`, err.response.data);
    } else {
      console.error(`❌ ERROR:`, err.message);
    }
  }
}

run();
