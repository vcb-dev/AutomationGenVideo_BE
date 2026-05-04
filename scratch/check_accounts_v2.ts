
import { PrismaClient, SocialPlatform } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAccounts() {
  console.log('--- DANH SÁCH TÀI KHOẢN SOCIAL ---');
  const accounts = await prisma.socialAccount.findMany({
    where: { is_active: true },
    select: {
      id: true,
      platform: true,
      platform_id: true,
      name: true,
      parent_id: true,
      updated_at: true,
      extra_data: true,
    }
  });

  accounts.forEach(acc => {
    console.log(`[${acc.platform}] ID: ${acc.id} | Name: ${acc.name} | PID: ${acc.platform_id} | Parent: ${acc.parent_id || 'NONE'} | Updated: ${acc.updated_at.toISOString()}`);
    if (acc.platform === 'INSTAGRAM') {
        console.log(`   -> Extra: ${JSON.stringify(acc.extra_data)}`);
    }
  });

  await prisma.$disconnect();
}

checkAccounts().catch(console.error);
