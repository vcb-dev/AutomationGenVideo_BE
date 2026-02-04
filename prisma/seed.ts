import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Create default manager account
  const managerPassword = await bcrypt.hash('manager123', 10);

  const manager = await prisma.user.upsert({
    where: { email: 'manager@vietchibao.com' },
    update: {},
    create: {
      email: 'manager@vietchibao.com',
      password_hash: managerPassword,
      full_name: 'Default Manager',
      role: 'MANAGER',
      is_active: true,
    },
  });

  console.log('✅ Manager account created:', manager.email);

  // Create test editor account
  const editorPassword = await bcrypt.hash('editor123', 10);

  const editor = await prisma.user.upsert({
    where: { email: 'editor@vietchibao.com' },
    update: {},
    create: {
      email: 'editor@vietchibao.com',
      password_hash: editorPassword,
      full_name: 'Test Editor',
      role: 'EDITOR',
      manager_id: manager.id,
      is_active: true,
    },
  });

  console.log('✅ Editor account created:', editor.email);

  // Create test content creator account
  const contentPassword = await bcrypt.hash('content123', 10);

  const content = await prisma.user.upsert({
    where: { email: 'content@vietchibao.com' },
    update: {},
    create: {
      email: 'content@vietchibao.com',
      password_hash: contentPassword,
      full_name: 'Test Content Creator',
      role: 'CONTENT',
      manager_id: manager.id,
      is_active: true,
    },
  });

  console.log('✅ Content Creator account created:', content.email);

  // Create specific manager for production use
  const bdCuongPassword = await bcrypt.hash('Vienchibao@6688', 10);

  const bdCuong = await prisma.user.upsert({
    where: { email: 'bdcuong@gmail.com' },
    update: {
      password_hash: bdCuongPassword, // Ensure password is set/reset
      role: 'MANAGER',
      is_active: true,
    },
    create: {
      email: 'bdcuong@gmail.com',
      password_hash: bdCuongPassword,
      full_name: 'BD Cuong Manager',
      role: 'MANAGER',
      is_active: true,
    },
  });
  console.log('✅ Real Manager account created/updated: bdcuong@gmail.com');

  console.log('\n📋 Test Accounts:');
  console.log('Manager: manager@vietchibao.com / manager123');
  console.log('Editor: editor@vietchibao.com / editor123');
  console.log('Content: content@vietchibao.com / content123');
  console.log('REAL MANAGER: bdcuong@gmail.com / Vienchibao@6688');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
