import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create default manager account
  const managerEmail = 'manager@vietchibao.com';
  const managerPassword = 'Manager123!';
  
  // Check if manager already exists
  const existingManager = await prisma.user.findUnique({
    where: { email: managerEmail },
  });

  if (existingManager) {
    console.log('✅ Default manager already exists:', managerEmail);
    return;
  }

  // Hash password
  const password_hash = await bcrypt.hash(managerPassword, 10);

  // Create manager
  const manager = await prisma.user.create({
    data: {
      email: managerEmail,
      password_hash,
      full_name: 'Default Manager',
      role: UserRole.MANAGER,
      is_active: true,
    },
  });

  console.log('✅ Created default manager account:');
  console.log('   Email:', managerEmail);
  console.log('   Password:', managerPassword);
  console.log('   ID:', manager.id);
  console.log('');
  console.log('🎉 Database seed completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
