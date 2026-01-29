import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Creating/Recreating Manager Account...\n');

  const MANAGER_EMAIL = 'manager@vietchibao.com';
  const MANAGER_PASSWORD = 'Manager@123'; // Plain text password for login

  // Delete existing manager if exists
  const existingManager = await prisma.user.findFirst({
    where: {
      email: MANAGER_EMAIL,
    },
  });

  if (existingManager) {
    console.log('🗑️  Deleting existing manager account...');
    await prisma.user.delete({
      where: { id: existingManager.id },
    });
    console.log('✅ Old account deleted\n');
  }

  // Hash the password (this is stored in database)
  const hashedPassword = await bcrypt.hash(MANAGER_PASSWORD, 10);

  // Create new manager account
  const manager = await prisma.user.create({
    data: {
      email: MANAGER_EMAIL,
      password_hash: hashedPassword,
      full_name: 'Viễn Chí Bảo Manager',
      role: UserRole.MANAGER,
      is_active: true,
    },
  });

  console.log('✅ Manager account created successfully!\n');
  console.log('═══════════════════════════════════════');
  console.log('📧 EMAIL    :', manager.email);
  console.log('🔑 PASSWORD :', MANAGER_PASSWORD);
  console.log('👤 NAME     :', manager.full_name);
  console.log('🎭 ROLE     :', manager.role);
  console.log('🆔 ID       :', manager.id);
  console.log('═══════════════════════════════════════');
  console.log('\n💡 Sử dụng thông tin trên để đăng nhập vào hệ thống');
  console.log('⚠️  Nên đổi mật khẩu sau lần đăng nhập đầu tiên!\n');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding manager:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
