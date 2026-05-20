import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const columns = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'users';
    `);
    console.log("Columns of public.users:", columns);
  } catch (e: any) {
    console.error("Failed to query columns of public.users:", e.message);
  }
}

main().then(() => prisma.$disconnect());
