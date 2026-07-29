const axios = require('axios');

async function test() {
  try {
    // 1. Log in to get token
    const loginRes = await axios.post('http://localhost:3000/api/auth/login', {
      email: 'admin@vietchibao.com',
      password: 'admin123'
    });
    const token = loginRes.data.token;
    console.log('✅ Logged in successfully. Token:', token.substring(0, 20) + '...');

    // 2. Get teams to get a valid team_id
    const teamsRes = await axios.get('http://localhost:3000/api/content-report/teams', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const team = teamsRes.data[0];
    console.log('✅ Got team:', team);

    // 3. Get periods to get a valid period_id
    const periodsRes = await axios.get('http://localhost:3000/api/content-report/periods', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const period = periodsRes.data[0];
    console.log('✅ Got period:', period);

    // 4. Send POST request to content-videos
    console.log('Sending POST to create content-video...');
    const createRes = await axios.post('http://localhost:3000/api/content-report/content-videos', {
      team_id: team.id,
      period_id: period.id,
      status: 'WIN',
      content: 'Nhấp đúp để nhập nội dung...',
      analysis: 'Nhấp đúp để nhập phân tích...',
      editor: 'Tên Editor',
      post_date: '2026-06-03',
      platform: 'Instagram Reels'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('✅ Created video response:', createRes.data);

  } catch (error) {
    if (error.response) {
      console.error('❌ Status:', error.response.status);
      console.error('❌ Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('❌ Error:', error.message);
    }
  }
}

test();
