const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const email = 'trunghieu2003hhh@gmail.com';

  console.log('🔍 Checking if user exists...');
  const existingUser = await prisma.user.findUnique({
    where: { email: email }
  });

  if (!existingUser) {
    console.log(`❌ Không tìm thấy user với email ${email}. Cần tạo mới.`);
    return;
  }

  console.log('🔄 User exists. Updating active status and roles to ADMIN + LEADER...');
  
  // Update bằng raw SQL để tránh nghẽn PgBouncer
  await prisma.$executeRawUnsafe(`
    UPDATE "users" 
    SET "is_active" = true, 
        "roles" = ARRAY['ADMIN', 'LEADER']::"UserRole"[], 
        "employee_position" = 'Leader', 
        "employee_status" = 'ON',
        "updated_at" = NOW()
    WHERE "email" = $1
  `, email);

  console.log(`✅ Updated user successfully via Raw SQL!`);
}

main()
  .catch((e) => {
    console.error('❌ Error updating user:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
