import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@vcb.com';
  const password = 'Password123!';
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      console.log('User already exists! Updating password and role...');
      await prisma.user.update({
        where: { email },
        data: { password_hash: hashedPassword, roles: [UserRole.ADMIN] }
      });
      console.log(`Success! Log in with Email: ${email} | Password: ${password}`);
    } else {
      await prisma.user.create({
        data: {
          email,
          full_name: 'Admin VCB',
          password_hash: hashedPassword,
          roles: [UserRole.ADMIN],
          is_active: true
        }
      });
      console.log(`Success! Created new user. Log in with Email: ${email} | Password: ${password}`);
    }
  } catch (error) {
    console.error('Error creating user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
