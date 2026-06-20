const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Checking users in database...');
  const user1 = await prisma.user.findUnique({
    where: { email: 'minhhienvienchibao@gmail.com' }
  });
  console.log('User 1 (minhhienvienchibao@gmail.com):', user1 ? {
    id: user1.id,
    email: user1.email,
    full_name: user1.full_name,
    roles: user1.roles,
    is_active: user1.is_active
  } : 'Not found');

  const user2 = await prisma.user.findUnique({
    where: { email: 'minhhien2101vs@gmail.com' }
  });
  console.log('User 2 (minhhien2101vs@gmail.com):', user2 ? {
    id: user2.id,
    email: user2.email,
    full_name: user2.full_name,
    roles: user2.roles,
    is_active: user2.is_active
  } : 'Not found');
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
