import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@vietchibao.com' },
    update: {},
    create: {
      email: 'admin@vietchibao.com',
      password_hash: adminPassword,
      full_name: 'Default Admin',
      roles: [UserRole.ADMIN],
      is_active: true,
    },
  });
  console.log('✅ Admin account created:', admin.email);

  const managerPassword = await bcrypt.hash('manager123', 10);
  const manager = await prisma.user.upsert({
    where: { email: 'manager@vietchibao.com' },
    update: {},
    create: {
      email: 'manager@vietchibao.com',
      password_hash: managerPassword,
      full_name: 'Default Manager',
      roles: [UserRole.MANAGER],
      is_active: true,
    },
  });
  console.log('✅ Manager account created:', manager.email);

  const leaderPassword = await bcrypt.hash('leader123', 10);
  const leader = await prisma.user.upsert({
    where: { email: 'leader@vietchibao.com' },
    update: {},
    create: {
      email: 'leader@vietchibao.com',
      password_hash: leaderPassword,
      full_name: 'Team Member 1',
      roles: [UserRole.MEMBER],
      manager_id: manager.id,
      is_active: true,
    },
  });
  console.log('✅ Member 1 account created:', leader.email);

  const editorPassword = await bcrypt.hash('editor123', 10);
  const editor = await prisma.user.upsert({
    where: { email: 'editor@vietchibao.com' },
    update: {},
    create: {
      email: 'editor@vietchibao.com',
      password_hash: editorPassword,
      full_name: 'Team Member 2',
      roles: [UserRole.MEMBER],
      manager_id: manager.id,
      is_active: true,
    },
  });
  console.log('✅ Member 2 account created:', editor.email);

  const admin2Password = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin2@vietchibao.com' },
    update: {},
    create: {
      email: 'admin2@vietchibao.com',
      password_hash: admin2Password,
      full_name: 'Admin 2',
      roles: [UserRole.ADMIN],
      is_active: true,
    },
  });
  console.log('✅ Admin 2 account created: admin2@vietchibao.com');

  const bdCuongPassword = await bcrypt.hash('Vienchibao@6688', 10);
  await prisma.user.upsert({
    where: { email: 'bdcuong@gmail.com' },
    update: { password_hash: bdCuongPassword, roles: [UserRole.MANAGER], is_active: true },
    create: {
      email: 'bdcuong@gmail.com',
      password_hash: bdCuongPassword,
      full_name: 'BD Cuong Manager',
      roles: [UserRole.MANAGER],
      is_active: true,
    },
  });
  console.log('✅ Real Manager account created/updated: bdcuong@gmail.com');

  console.log('\n📋 Test Accounts:');
  console.log('Admin:    admin@vietchibao.com / admin123 → [ADMIN]');
  console.log('Admin 2:  admin2@vietchibao.com / admin123 → [ADMIN]');
  console.log('Manager:  manager@vietchibao.com / manager123 → [MANAGER]');
  console.log('Member 1: leader@vietchibao.com / leader123 → [MEMBER]');
  console.log('Member 2: editor@vietchibao.com / editor123 → [MEMBER]');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
