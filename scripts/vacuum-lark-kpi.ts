/**
 * VACUUM bảng kpi trên Supabase để thu gọn dead tuples
 * và khôi phục tốc độ truy vấn bình thường
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const DB_URL: string = process.env.SERVER_DATABASE_URL!;
if (!DB_URL) { console.error('Missing SERVER_DATABASE_URL'); process.exit(1); }

async function main() {
  // VACUUM requires a direct connection (not inside a transaction)
  // PgBouncer port 6543 supports VACUUM if we use connection_limit=1
  const url = DB_URL.includes('?') ? `${DB_URL}&connection_limit=1` : `${DB_URL}?connection_limit=1`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  console.log('🧹 Starting VACUUM on kpi table...');
  
  let t = Date.now();
  
  // First, ANALYZE to update statistics
  try {
    console.log('  → Running ANALYZE on kpi...');
    await prisma.$executeRawUnsafe('ANALYZE "kpi"');
    console.log(`  ✅ ANALYZE done: ${Date.now() - t}ms`);
  } catch (e: any) {
    console.log(`  ⚠️  ANALYZE failed (may need direct connection): ${e.message?.slice(0, 100)}`);
  }

  // Try VACUUM (may fail on PgBouncer, that's OK)
  try {
    t = Date.now();
    console.log('  → Running VACUUM on kpi...');
    await prisma.$executeRawUnsafe('VACUUM "kpi"');
    console.log(`  ✅ VACUUM done: ${Date.now() - t}ms`);
  } catch (e: any) {
    console.log(`  ⚠️  VACUUM failed on PgBouncer (expected): ${e.message?.slice(0, 150)}`);
    console.log('  💡 Please run VACUUM manually from Supabase Dashboard → SQL Editor:');
    console.log('     VACUUM FULL "kpi";');
    console.log('     VACUUM FULL "kpi_do_da";');
  }

  // Test speed after VACUUM/ANALYZE
  t = Date.now();
  const rows: any[] = await prisma.$queryRawUnsafe('SELECT COUNT(*) as cnt FROM "kpi"');
  console.log(`\n📊 COUNT after cleanup: ${Date.now() - t}ms (${rows[0]?.cnt} rows)`);

  await prisma.$disconnect();
  console.log('\n✅ Done!');
}

main().catch(e => { console.error('❌ Failed:', e.message); process.exit(1); });
