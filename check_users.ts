import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      email: true,
      full_name: true,
      roles: true,
    }
  });
  
  const roleCounts: Record<string, number> = {};
  users.forEach(u => {
    const r = u.roles.join(',');
    roleCounts[r] = (roleCounts[r] || 0) + 1;
  });

  console.log('--- USER ROLES SUMMARY ON CLOUD SQL ---');
  console.log(roleCounts);

  console.log('\n--- LIST ALL USERS ---');
  users.forEach(u => {
    console.log(`${u.email.padEnd(30)} | ${u.full_name.padEnd(20)} | ${u.roles}`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
