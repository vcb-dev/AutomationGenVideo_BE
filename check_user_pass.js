
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({
    where: {
      email: 'haducbaoviet0911@gmail.com'
    }
  });
  if (user) {
    console.log(`User: ${user.full_name || user.email}`);
    console.log(`Password (Hashed): ${user.password}`);
    // Check if there are other password related fields
    for (const key in user) {
        if (key.toLowerCase().includes('pass')) {
            console.log(`${key}: ${user[key]}`);
        }
    }
  } else {
    console.log("User not found.");
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
