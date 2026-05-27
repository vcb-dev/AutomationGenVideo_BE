import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@vcb.vn';
  const password = 'khaiem2k4';

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      password_hash: passwordHash,
      roles: [UserRole.ADMIN],
      is_active: true,
      full_name: 'Admin VCB',
    },
    create: {
      email,
      password_hash: passwordHash,
      full_name: 'Admin VCB',
      roles: [UserRole.ADMIN],
      is_active: true,
    },
  });

  console.log('✅ Admin account created/updated:');
  console.log(`   Email:    ${admin.email}`);
  console.log(`   Password: ${password}`);
  console.log(`   Role:     ${admin.roles.join(', ')}`);
  console.log(`   ID:       ${admin.id}`);
}

main()
  .catch((e) => { console.error('❌ Error:', e.message); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
