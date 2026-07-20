import { PrismaClient, UserRole } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const email = 'minhhien2101vs@gmail.com';
  const fullName = 'Bùi Minh Hiền';

  // Kiểm tra xem user đã tồn tại chưa
  const existingUser = await prisma.user.findUnique({
    where: { email: email }
  });

  if (existingUser) {
    console.log(`ℹ️ User với email ${email} đã tồn tại:`, existingUser);
    return;
  }

  // Tạo user mới
  const newUser = await prisma.user.create({
    data: {
      email: email,
      full_name: fullName,
      roles: {
        set: [UserRole.MEMBER]
      },
      is_active: true
    }
  });

  console.log(`✅ Đã tạo thành công user mới:`, {
    id: newUser.id,
    full_name: newUser.full_name,
    email: newUser.email,
    roles: newUser.roles,
    is_active: newUser.is_active
  });
}

main()
  .catch((e) => {
    console.error('❌ Lỗi khi thêm user:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
