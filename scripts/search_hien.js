const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Fetching all users from database...');
  const allUsers = await prisma.user.findMany({
    select: {
      email: true,
      full_name: true,
      roles: true,
      is_active: true
    }
  });

  console.log(`📊 Total users in DB: ${allUsers.length}`);

  const filtered = allUsers.filter(u => {
    const fn = (u.full_name || '').toLowerCase();
    const em = (u.email || '').toLowerCase();
    return fn.includes('hiên') || fn.includes('hiển') || fn.includes('hiền') || em.includes('hien');
  });

  console.log('Filtered Results:', JSON.stringify(filtered, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
