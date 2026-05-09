import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const serverUrl = process.env.SERVER_DATABASE_URL;
  if (!serverUrl) {
    console.error('Missing SERVER_DATABASE_URL');
    process.exit(1);
  }

  const serverUrlWithLimit = serverUrl.includes('?') 
    ? `${serverUrl}&connection_limit=1` 
    : `${serverUrl}?connection_limit=1`;

  const server = new PrismaClient({ datasources: { db: { url: serverUrlWithLimit } } });

  console.log('⚠️  WIPING DATA ON REMOTE SERVER...');

  try {
    // Wipe Users only — lark_kpi is handled by UPSERT in force-sync, no need to delete
    const userCount = await server.user.deleteMany({});
    console.log(`✅ Wiped Users: ${userCount.count} records`);

    console.log('--- WIPE COMPLETED ---');
  } catch (error) {
    console.error('❌ Wipe failed:', error);
  } finally {
    await server.$disconnect();
  }
}

main();
