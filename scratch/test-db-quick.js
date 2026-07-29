const { Client } = require('pg');

const url = "postgresql://postgres.mzptvnhqynxtujxuxlmx:%40Nguyencongtoan3110@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true";

async function run() {
  const client = new Client({ connectionString: url });
  client.on('error', (err) => console.log(`[Event]: ${err.message}`));
  
  try {
    console.log("Testing Supabase PgBouncer connection...");
    await client.connect();
    const res = await client.query('SELECT COUNT(*) as cnt FROM "User"');
    console.log(`✅ SUCCESS! Database is accessible. ${res.rows[0].cnt} users found.`);
    await client.end();
  } catch (err) {
    console.error(`❌ FAILED: ${err.message}`);
    try { await client.end(); } catch {}
  }
}

run();
