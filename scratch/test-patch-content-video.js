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

    // Get the first video in the database
    const videosRes = await axios.get(`${baseURL}/content-report/data?team=K1&periodId=8c3c89f0-6591-4c99-8bff-fc6a99d181ed`, { headers });
    const video = videosRes.data.videos[0];
    if (!video) {
      console.log("No videos found to patch.");
      return;
    }

    console.log(`Patching video ${video.dbId}...`);
    const payload = {
      content: 'Updated content at ' + new Date().toISOString()
    };

    const patchRes = await axios.patch(`${baseURL}/content-report/content-videos/${video.dbId}`, payload, { headers });
    console.log("✅ Success! Response:", patchRes.data);
  } catch (err) {
    if (err.response) {
      console.error(`❌ FAILED:`, err.response.data);
    } else {
      console.error(`❌ ERROR:`, err.message);
    }
  }
}

run();
