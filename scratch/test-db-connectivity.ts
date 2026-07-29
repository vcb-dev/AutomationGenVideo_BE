import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const prisma = new PrismaClient();
  const start = Date.now();
  try {
    const r = await prisma.$queryRawUnsafe(`SELECT now() as db_time, 1+1 as check`);
    console.log('DB reachable OK, took', Date.now() - start, 'ms', JSON.stringify(r));
  } catch (e: any) {
    console.log('DB connection FAILED after', Date.now() - start, 'ms:', e.message);
  }

  // Simulate an INSERT similar to submitChecklistReport to see if writes actually fail
  const start2 = Date.now();
  try {
    const test = await prisma.checklistReport.count();
    console.log('checklist_reports count OK, took', Date.now() - start2, 'ms ->', test);
  } catch (e: any) {
    console.log('checklist_reports query FAILED after', Date.now() - start2, 'ms:', e.message);
  }

  await prisma.$disconnect();
}
main();
