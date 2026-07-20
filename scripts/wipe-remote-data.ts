import * as dotenv from 'dotenv';
import { getRemoteDbUrl, withRemoteClient } from './lib/remote-prisma';

dotenv.config();

async function main() {
  if (!process.env.SERVER_DATABASE_URL) {
    console.error('Missing SERVER_DATABASE_URL');
    process.exit(1);
  }

  const serverUrl = getRemoteDbUrl(true);
  console.log('🧹 Clearing sync buffer tables (users/channels/social giữ nguyên)...');

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

    console.log('--- DONE (sync scripts sẽ tự update/replace data) ---');
  } catch (error) {
    console.error('❌ Failed:', error);
    process.exit(1);
  }
}

main();
