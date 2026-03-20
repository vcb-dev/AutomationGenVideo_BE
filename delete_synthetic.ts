import { PrismaClient } from '@prisma/client';

const prismaLocal = new PrismaClient({
    datasources: { db: { url: "postgresql://postgres:postgres@127.0.0.1:5432/video_production?schema=public" } }
});

const prismaCloud = new PrismaClient({
    datasources: { db: { url: "postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?schema=public" } }
});

async function main() {
  console.log('🔄 Bắt đầu dọn dẹp các tài khoản ảo...');

  const localRes = await prismaLocal.user.deleteMany({
      where: { email: { endsWith: '@employee.vcb.internal' } }
  });
  console.log(`✅ LOCAL DB: Đã xoá thành công ${localRes.count} tài khoản email ảo.`);

  const cloudRes = await prismaCloud.user.deleteMany({
      where: { email: { endsWith: '@employee.vcb.internal' } }
  });
  console.log(`✅ CLOUD DB: Đã xoá thành công ${cloudRes.count} tài khoản email ảo.`);

  console.log('🎉 Hoàn tất sạch sẽ dứt điểm!');
}

main().finally(() => { prismaLocal.$disconnect(); prismaCloud.$disconnect(); });
