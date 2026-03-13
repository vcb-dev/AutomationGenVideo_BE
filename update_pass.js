
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  const email = 'haducbaoviet0911@gmail.com';
  const newPassword = 'Khaicubui2k4@';
  
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(newPassword, salt);
  
  const updatedUser = await prisma.user.update({
    where: {
      email: email
    },
    data: {
      password_hash: passwordHash
    }
  });
  
  console.log(`Successfully updated password for: ${updatedUser.email}`);
  console.log(`New Hash: ${updatedUser.password_hash}`);
}

main()
  .catch(e => {
    console.error('Error updating password:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
