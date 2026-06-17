const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

async function main() {
  const email = 'minhhien2101vs@gmail.com';
  const fullName = 'Bùi Minh Hiền';

  console.log('🔍 Checking if user exists...');
  const existingUser = await prisma.user.findUnique({
    where: { email: email }
  });

  if (existingUser) {
    console.log(`ℹ️ User with email ${email} already exists:`, existingUser);
    return;
  }

  console.log('➕ Inserting new user using raw SQL with UUID cast...');
  const id = crypto.randomUUID();
  
  // Cast $1::uuid để PostgreSQL hiểu đúng kiểu dữ liệu
  await prisma.$executeRawUnsafe(`
    INSERT INTO "users" (
      "id", "email", "full_name", "roles", "is_active", 
      "custom_permissions", "created_at", "updated_at"
    ) VALUES (
      $1::uuid, $2, $3, ARRAY['MEMBER']::"UserRole"[], true, 
      ARRAY[]::text[], NOW(), NOW()
    )
  `, id, email, fullName);

  console.log(`✅ Created user successfully via Raw SQL!`);
}

main()
  .catch((e) => {
    console.error('❌ Error adding user:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
