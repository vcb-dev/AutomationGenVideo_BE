import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const email = 'haducbaoviet@gmail.com';
  
  const user = await prisma.user.findUnique({
    where: { email: email }
  });

  if (!user) {
    console.error(`❌ Không tìm thấy user với email: ${email}`);
    return;
  }

  console.log(`👤 User hiện tại:`, {
    full_name: user.full_name,
    email: user.email,
    roles: user.roles,
    employee_position: user.employee_position
  });

  const updatedUser = await prisma.user.update({
    where: { email: email },
    data: {
      roles: {
        set: ['LEADER']
      },
      employee_position: 'Leader'
    }
  });

  console.log(`✅ Cập nhật thành công!`);
  console.log(`👤 User mới:`, {
    full_name: updatedUser.full_name,
    email: updatedUser.email,
    roles: updatedUser.roles,
    employee_position: updatedUser.employee_position
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
