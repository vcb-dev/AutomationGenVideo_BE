import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const serverUrl = process.env.SERVER_DATABASE_URL;
  if (!serverUrl) {
    console.error('Missing SERVER_DATABASE_URL');
    process.exit(1);
  }

  const server = new PrismaClient({ datasources: { db: { url: serverUrl } } });

  console.log('⚠️  WIPING DATA ON REMOTE SERVER...');

  try {
    // Fetch IDs of records to delete (preserving Đồ Da)
    const recordsToDelete = await server.larkKPI.findMany({
      where: {
        NOT: {
          team: {
            contains: 'Đồ Da',
            mode: 'insensitive'
          }
        }
      },
      select: { id: true }
    });

    const ids = recordsToDelete.map(r => r.id);
    console.log(`Found ${ids.length} records to wipe...`);

    if (ids.length > 0) {
      // Very small chunk size (10) with 100ms delay to keep query times well below PgBouncer's strict limits
      const CHUNK = 10;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        await server.$executeRaw`DELETE FROM lark_kpi WHERE id = ANY(${chunk})`;
        if (i % 200 === 0) {
          console.log(`  Wiped ${i}/${ids.length}...`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }


    // Wipe Users
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




