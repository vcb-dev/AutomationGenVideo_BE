import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JUNK_ID = 'c46476fb-e4af-4ce7-bbf3-b2c538abfe62';

async function main() {
  const user = await prisma.user.findUnique({
    where: { id: JUNK_ID },
    include: {
      _count: {
        select: {
          social_accounts: true,
          social_posts: true,
          videos: true,
          tracked_channels: true,
          team_memberships: true,
          tasks_assigned: true,
        },
      },
    },
  });
  if (!user) {
    console.log('User không tồn tại (có thể đã xoá).');
    return;
  }
  console.log('User rác:', { email: user.email, full_name: user.full_name, counts: user._count });
  const hasData = Object.values(user._count).some((c) => c > 0);
  if (hasData) {
    console.log('CẢNH BÁO: user có dữ liệu liên quan — không xoá tự động.');
    return;
  }
  await prisma.user.delete({ where: { id: JUNK_ID } });
  console.log('Đã xoá user rác.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
