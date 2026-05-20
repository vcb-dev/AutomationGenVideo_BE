import { Client } from 'pg';

async function main() {
  const urls = [
    "postgresql://postgres:postgres@localhost:5432/video_production",
    "postgresql://postgres:talent_secret@localhost:5433/talent_management"
  ];

  for (const url of urls) {
    console.log(`Connecting to ${url}...`);
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      const res = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public';
      `);
      console.log(`Tables for ${url}:`, res.rows.map((r: any) => r.table_name));
      await client.end();
    } catch (e: any) {
      console.error(`Failed for ${url}:`, e.message);
    }
  }
}

main();
