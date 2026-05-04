import { PrismaClient } from '@prisma/client';

async function main() {
  const serverUrl = process.env.SERVER_DATABASE_URL;
  if (!serverUrl) {
    console.error('Missing SERVER_DATABASE_URL');
    process.exit(1);
  }

  const server = new PrismaClient({ datasources: { db: { url: serverUrl } } });

  console.log('⚠️  WIPING DATA ON REMOTE SERVER...');

  try {
    // Wipe LarkKPI
    const kpiCount = await server.larkKPI.deleteMany({});
    console.log(`✅ Wiped LarkKPI: ${kpiCount.count} records`);

    // Wipe Users
    // NOTE: This will delete ALL users. Make sure you sync back immediately!
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
