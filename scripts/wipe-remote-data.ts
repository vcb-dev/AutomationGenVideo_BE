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
    // Wipe all main tables for a fresh sync
    const userCount = await server.user.deleteMany({});
    console.log(`✅ Wiped Users: ${userCount.count} records`);

    const channelCount = await server.channel.deleteMany({});
    console.log(`✅ Wiped Channels: ${channelCount.count} records`);

    const kpiCount = await (server as any).larkKPI.deleteMany({});
    console.log(`✅ Wiped LarkKPI: ${kpiCount.count} records`);

    const dodaCount = await (server as any).larkKpiDoDaEditor.deleteMany({});
    console.log(`✅ Wiped LarkKPI DoDa: ${dodaCount.count} records`);

    console.log('--- ALL DATA WIPED ---');
  } catch (error) {
    console.error('❌ Wipe failed:', error);
  } finally {
    await server.$disconnect();
  }
}

main();
