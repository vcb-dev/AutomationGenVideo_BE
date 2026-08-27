import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const rows: any[] = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'content_transform_histories'
      AND column_name IN ('input_tokens', 'output_tokens', 'cost_usd')
    ORDER BY column_name;
  `);
  console.log(rows);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
