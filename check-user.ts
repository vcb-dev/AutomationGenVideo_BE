import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function checkUser() {
  try {
    console.log('🔍 Checking user: manager@vietchibao.com');

    const user = await prisma.user.findUnique({
      where: { email: 'manager@vietchibao.com' },
      select: {
        id: true,
        email: true,
        full_name: true,
        roles: true,
        password_hash: true,
        is_active: true,
      },
    });

    if (!user) {
      console.log('❌ User not found!');
      console.log('\n📝 Creating user...');

      const hashedPassword = await bcrypt.hash('manager123', 10);

      const newUser = await prisma.user.create({
        data: {
          email: 'manager@vietchibao.com',
          password_hash: hashedPassword,
          full_name: 'Viễn Chí Bảo Manager',
          roles: ['MANAGER'],
          is_active: true,
        },
      });

      console.log('✅ User created:', {
        id: newUser.id,
        email: newUser.email,
        roles: newUser.roles,
      });
    } else {
      console.log('✅ User found:', {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        roles: user.roles,
        is_active: user.is_active,
      });

      // Test password
      const isPasswordValid = await bcrypt.compare('manager123', user.password_hash!);
      console.log('\n🔐 Password test:');
      console.log('  Password "manager123" is valid:', isPasswordValid);

      if (!isPasswordValid) {
        console.log('\n🔄 Updating password...');
        const hashedPassword = await bcrypt.hash('manager123', 10);
        await prisma.user.update({
          where: { id: user.id },
          data: { password_hash: hashedPassword },
        });
        console.log('✅ Password updated!');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUser();
