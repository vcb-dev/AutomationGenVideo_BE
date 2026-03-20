import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const plainPassword = 'Hieu123@';
  
  // Bcrypt requires a salt round value normally wait let's just generate the salt
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(plainPassword, salt);

  // 1. Upsert Admin Account
  const admin = await prisma.user.upsert({
    where: { email: 'admin@gmail.com' },
    update: {
      password_hash: passwordHash,
      roles: ['ADMIN'],
      is_active: true,
    },
    create: {
      email: 'admin@gmail.com',
      full_name: 'Admin Tổng',
      password_hash: passwordHash,
      roles: ['ADMIN'],
      is_active: true,
    },
  });
  console.log(`✅ Upserted Admin Account: ${admin.email}`);

  // 2. Upsert Leader Account
  const leader = await prisma.user.upsert({
    where: { email: 'leader@gmail.com' },
    update: {
      password_hash: passwordHash,
      roles: ['LEADER'],
      is_active: true,
    },
    create: {
      email: 'leader@gmail.com',
      full_name: 'Leader Nhóm',
      password_hash: passwordHash,
      roles: ['LEADER'],
      is_active: true,
    },
  });
  console.log(`✅ Upserted Leader Account: ${leader.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
