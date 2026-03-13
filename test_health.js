
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testConnections() {
  console.log('--- Testing Database Connection ---');
  try {
    await prisma.$connect();
    console.log('[SUCCESS] Database connected.');
    const userCount = await prisma.user.count();
    console.log(`[DATA] User count: ${userCount}`);
  } catch (e) {
    console.error('[FAIL] Database connection failed:', e.message);
  }

  console.log('\n--- Testing Internet Connection (Lark) ---');
  try {
    const res = await axios.get('https://open.larksuite.com/open-apis/authen/v1/index', { timeout: 5000 });
    console.log(`[SUCCESS] Lark reachable. Status: ${res.status}`);
  } catch (e) {
    console.error(`[FAIL] Lark unreachable: ${e.message}`);
  }

  console.log('\n--- Testing AI Service ---');
  try {
    const res = await axios.get('http://localhost:8001/api/channels/check-by-username/', { timeout: 2000 }).catch(e=>e.response);
    // 405 Method Not Allowed is fine because we used GET on a POST endpoint, but it means server is up
    if (res && (res.status === 200 || res.status === 405)) {
      console.log(`[SUCCESS] AI Service is UP (Status: ${res.status})`);
    } else {
      console.log(`[WARNING] AI Service returned unexpected status: ${res?.status}`);
    }
  } catch (e) {
    console.error(`[FAIL] AI Service unreachable: ${e.message}`);
  }
}

testConnections().finally(() => prisma.$disconnect());
