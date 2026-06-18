const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const email = 'trunghieu2003hhh@gmail.com';
  const user = await prisma.user.findUnique({
    where: { email: email }
  });
  console.log('User status now:', JSON.stringify(user, null, 2));
}

main().finally(() => prisma.$disconnect());
