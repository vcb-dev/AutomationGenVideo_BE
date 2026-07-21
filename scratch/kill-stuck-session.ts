import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
  const r: any[] = await prisma.$queryRawUnsafe(`SELECT pg_terminate_backend(1811393) AS terminated`);
  console.log('Terminated:', r[0].terminated);
  await prisma.$disconnect();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
