const { Client } = require('pg');

// Test direct connection without pgbouncer
const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.wbiumzxlfvlzenyuykxe',
  password: 'trunghieu2003Hh@',
});

client.connect().then(() => {
  console.log('✓ Connected successfully');
  return client.query("SELECT 1");
}).then(() => {
  console.log('✓ Query executed');
  return client.query("SELECT * FROM _prisma_migrations LIMIT 1");
}).then(res => {
  console.log('✓ Migrations table accessible:', res.rows.length, 'rows');
  process.exit(0);
}).catch(err => {
  console.error('✗ Error:', err.message);
  process.exit(1);
}).finally(() => {
  client.end();
});
