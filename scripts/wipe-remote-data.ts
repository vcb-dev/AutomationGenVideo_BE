import * as dotenv from 'dotenv';
import { deleteTableInBatches, getRemoteDbUrl, withRemoteClient } from './lib/remote-prisma';

dotenv.config();

async function main() {
  if (!process.env.SERVER_DATABASE_URL) {
    console.error('Missing SERVER_DATABASE_URL');
    process.exit(1);
  }

  const serverUrl = getRemoteDbUrl(true);
  console.log('⚠️  WIPING REMOTE (users + channels — KPI tables cleared by sync scripts)...');

  try {
    await withRemoteClient(serverUrl, async (prisma) => {
      console.log('🔗 Connected');
      for (const t of [
        'sync_lark_kpi_buffer',
        'sync_lark_kpi_doda_editor_buffer',
        'sync_channels_buffer',
      ]) {
        console.log(`   → DROP ${t}...`);
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${t}`);
        console.log(`   ✅ ${t}`);
      }
    });

    console.log('   → DELETE huyk_channels (batched)...');
    const channels = await deleteTableInBatches(serverUrl, 'huyk_channels', 200, (n) =>
      console.log(`      … ${n} rows`),
    );
    console.log(`   ✅ huyk_channels (${channels} rows)`);

    console.log('   → DELETE users (batched)...');
    const users = await deleteTableInBatches(serverUrl, 'users', 100, (n) =>
      console.log(`      … ${n} rows`),
    );
    console.log(`   ✅ users (${users} rows)`);

    console.log('--- WIPE DONE (lark_kpi* cleared by force-sync-kpi scripts) ---');
  } catch (error) {
    console.error('❌ Wipe failed:', error);
    console.error('💡 Ctrl+C → docker stop BE production → chạy lại.');
    process.exit(1);
  }
}

main();
