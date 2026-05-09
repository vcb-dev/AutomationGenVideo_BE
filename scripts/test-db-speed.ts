/**
 * Diagnostic script: kiểm tra tốc độ kết nối và INSERT vào bảng lark_kpi
 * trên Supabase PgBouncer port 6543
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const DB_URL: string = process.env.SERVER_DATABASE_URL!;
if (!DB_URL) { console.error('Missing SERVER_DATABASE_URL'); process.exit(1); }

async function main() {
  const url = DB_URL.includes('?') ? `${DB_URL}&connection_limit=1` : `${DB_URL}?connection_limit=1`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  console.log('=== DATABASE SPEED TEST ===');
  console.log(`URL: ...${DB_URL.slice(-50)}`);

  // Test 1: Connection
  let t = Date.now();
  await prisma.$connect();
  console.log(`✅ Test 1 - Connect: ${Date.now() - t}ms`);

  // Test 2: Simple SELECT
  t = Date.now();
  const count = await prisma.$executeRawUnsafe('SELECT 1');
  console.log(`✅ Test 2 - SELECT 1: ${Date.now() - t}ms`);

  // Test 3: Count lark_kpi
  t = Date.now();
  const rows: any[] = await prisma.$queryRawUnsafe('SELECT COUNT(*) as cnt FROM "lark_kpi"');
  console.log(`✅ Test 3 - COUNT lark_kpi: ${Date.now() - t}ms (${rows[0]?.cnt} rows)`);

  // Test 4: Count Đồ Da only
  t = Date.now();
  const dodaRows: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "lark_kpi" WHERE LOWER(COALESCE("team",'')) LIKE '%đồ da%' OR LOWER(COALESCE("team",'')) LIKE '%do da%'`);
  console.log(`✅ Test 4 - COUNT Đồ Da: ${Date.now() - t}ms (${dodaRows[0]?.cnt} rows)`);

  // Test 5: INSERT 1 row raw SQL
  t = Date.now();
  const testId = `test_speed_${Date.now()}`;
  await prisma.$executeRawUnsafe(`
    INSERT INTO "lark_kpi" ("id", "name", "team", "kpi_day", "kpi_month", "completed_day", "completed_month", "task_new", "task_new_month", "task_auto", "task_auto_month", "task_creative", "revenue_month", "traffic_month", "created_at", "updated_at")
    VALUES ('${testId}', 'TEST', 'TEST_TEAM', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, NOW(), NOW())
  `);
  console.log(`✅ Test 5 - INSERT 1 row (raw SQL): ${Date.now() - t}ms`);

  // Test 6: INSERT 10 rows raw SQL
  t = Date.now();
  const vals10 = Array.from({length: 10}, (_, i) => 
    `('test_10_${Date.now()}_${i}', 'TEST${i}', 'TEST_TEAM', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, NOW(), NOW())`
  ).join(',');
  await prisma.$executeRawUnsafe(`
    INSERT INTO "lark_kpi" ("id", "name", "team", "kpi_day", "kpi_month", "completed_day", "completed_month", "task_new", "task_new_month", "task_auto", "task_auto_month", "task_creative", "revenue_month", "traffic_month", "created_at", "updated_at")
    VALUES ${vals10}
  `);
  console.log(`✅ Test 6 - INSERT 10 rows (raw SQL): ${Date.now() - t}ms`);

  // Test 7: INSERT 50 rows raw SQL
  t = Date.now();
  const vals50 = Array.from({length: 50}, (_, i) => 
    `('test_50_${Date.now()}_${i}', 'TEST${i}', 'TEST_TEAM', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, NOW(), NOW())`
  ).join(',');
  await prisma.$executeRawUnsafe(`
    INSERT INTO "lark_kpi" ("id", "name", "team", "kpi_day", "kpi_month", "completed_day", "completed_month", "task_new", "task_new_month", "task_auto", "task_auto_month", "task_creative", "revenue_month", "traffic_month", "created_at", "updated_at")
    VALUES ${vals50}
  `);
  console.log(`✅ Test 7 - INSERT 50 rows (raw SQL): ${Date.now() - t}ms`);

  // Test 8: Prisma createMany 10 rows
  t = Date.now();
  await prisma.larkKPI.createMany({
    data: Array.from({length: 10}, (_, i) => ({
      id: `test_prisma_${Date.now()}_${i}`,
      name: `PRISMA_TEST_${i}`,
      team: 'PRISMA_TEST_TEAM',
      kpi_day: 0, kpi_month: 0, completed_day: 0, completed_month: 0,
      task_new: 0, task_new_month: 0, task_auto: 0, task_auto_month: 0,
      task_creative: 0, revenue_month: BigInt(0), traffic_month: BigInt(0)
    })),
    skipDuplicates: true
  });
  console.log(`✅ Test 8 - Prisma createMany 10 rows: ${Date.now() - t}ms`);

  // Test 9: Prisma createMany 100 rows
  t = Date.now();
  await prisma.larkKPI.createMany({
    data: Array.from({length: 100}, (_, i) => ({
      id: `test_prisma100_${Date.now()}_${i}`,
      name: `PRISMA_TEST_${i}`,
      team: 'PRISMA_TEST_TEAM',
      kpi_day: 0, kpi_month: 0, completed_day: 0, completed_month: 0,
      task_new: 0, task_new_month: 0, task_auto: 0, task_auto_month: 0,
      task_creative: 0, revenue_month: BigInt(0), traffic_month: BigInt(0)
    })),
    skipDuplicates: true
  });
  console.log(`✅ Test 9 - Prisma createMany 100 rows: ${Date.now() - t}ms`);

  // Cleanup test data
  t = Date.now();
  await prisma.$executeRawUnsafe(`DELETE FROM "lark_kpi" WHERE "id" LIKE 'test_%'`);
  console.log(`✅ Cleanup: ${Date.now() - t}ms`);

  console.log('\n=== TEST COMPLETE ===');
  await prisma.$disconnect();
}

main().catch(e => { console.error('❌ FAILED:', e.message); process.exit(1); });
