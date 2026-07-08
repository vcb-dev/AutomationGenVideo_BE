const { Client } = require('pg');

const host = "aws-1-ap-southeast-2.pooler.supabase.com";
const user = "postgres.zwqgqhevnsnevsttyioo";
const database = "postgres";

const passwords = ["VIetha091104", "vietha091104", "Vietha091104", "VIETHA091104"];

async function test(password) {
  const client = new Client({
    host,
    user,
    database,
    password,
    port: 5432,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log(`✅ SUCCESS with password: ${password}`);
    await client.end();
    return true;
  } catch (err) {
    console.log(`❌ FAILED with password ${password}: ${err.message}`);
    try { await client.end(); } catch {}
    return false;
  }
}

async function run() {
  for (const pw of passwords) {
    const ok = await test(pw);
    if (ok) break;
  }
}

run();
