const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const email = 'trunghieu2003hhh@gmail.com';
  
  // Tìm user trước để đảm bảo tồn tại
  const user = await prisma.user.findUnique({
    where: { email: email }
  });

  if (!user) {
    console.error(`❌ Không tìm thấy user với email: ${email}`);
    return;
  }

  // Update role lên LEADER
  const updatedUser = await prisma.user.update({
    where: { email: email },
    data: {
      roles: {
        set: ['LEADER'] // Ghi đè hoặc dùng push nếu muốn giữ role cũ
      },
      employee_position: 'Leader'
    }
  });

  console.log(`✅ Đã cập nhật thành công user: ${updatedUser.full_name}`);
  console.log(`📧 Email: ${updatedUser.email}`);
  console.log(`🔑 Quyền mới: ${updatedUser.roles.join(', ')}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
