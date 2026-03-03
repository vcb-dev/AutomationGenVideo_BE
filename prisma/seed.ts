import { PrismaClient } from '@prisma/client';
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
      roles: ['ADMIN'],
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
      roles: ['MANAGER'],
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
      full_name: 'Team Leader',
      roles: ['LEADER'],
      manager_id: manager.id,
      is_active: true,
    },
  });
  console.log('✅ Leader account created:', leader.email);

  const editorPassword = await bcrypt.hash('editor123', 10);
  const editor = await prisma.user.upsert({
    where: { email: 'editor@vietchibao.com' },
    update: {},
    create: {
      email: 'editor@vietchibao.com',
      password_hash: editorPassword,
      full_name: 'Test Editor',
      roles: ['EDITOR', 'CONTENT'],
      manager_id: manager.id,
      team_leader_id: leader.id,
      is_active: true,
    },
  });
  console.log('✅ Editor account created:', editor.email);

  const bdCuongPassword = await bcrypt.hash('Vienchibao@6688', 10);
  await prisma.user.upsert({
    where: { email: 'bdcuong@gmail.com' },
    update: { password_hash: bdCuongPassword, roles: ['MANAGER'], is_active: true },
    create: {
      email: 'bdcuong@gmail.com',
      password_hash: bdCuongPassword,
      full_name: 'BD Cuong Manager',
      roles: ['MANAGER'],
      is_active: true,
    },
  });
  console.log('✅ Real Manager account created/updated: bdcuong@gmail.com');

  console.log('\n📋 Test Accounts:');
  console.log('Admin:    admin@vietchibao.com / admin123 → [ADMIN]');
  console.log('Manager:  manager@vietchibao.com / manager123 → [MANAGER]');
  console.log('Leader:   leader@vietchibao.com / leader123 → [LEADER]');
  console.log('Editor:   editor@vietchibao.com / editor123 → [EDITOR, CONTENT]');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
