const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const users = await prisma.user.findMany({ where: { full_name: { contains: 'Toán' } } });
  console.log(JSON.stringify(users, null, 2));
}
run();
