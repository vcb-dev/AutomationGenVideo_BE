import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT id, email, full_name, roles, is_active, created_at
    FROM users
    WHERE email IS NULL OR email = ''
       OR full_name IS NULL OR full_name = ''
       OR cardinality(roles) = 0
  `);
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
