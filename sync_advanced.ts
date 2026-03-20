import { PrismaClient } from '@prisma/client';

const prismaLocal = new PrismaClient({
  datasources: { db: { url: "postgresql://postgres:postgres@127.0.0.1:5432/video_production?schema=public" } }
});

const prismaCloud = new PrismaClient({
  datasources: { db: { url: "postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?schema=public" } }
});

async function main() {
  const localUsers = await prismaLocal.user.findMany();
  const cloudUsers = await prismaCloud.user.findMany();
  
  let updatedCounter = 0;
  let createdCounter = 0;

  for (const localU of localUsers) {
    // Tự bỏ qua các user ảo của localhost nếu có
    if (localU.email.endsWith('@employee.vcb.internal')) continue;

    const { id, manager_id, team_leader_id, ...userData } = localU;

    // 1. Xem Cloud đã có email này chưa
    const cloudByEmail = cloudUsers.find(cu => cu.email.toLowerCase() === localU.email.toLowerCase());

    if (cloudByEmail) {
      // Đã tồn tại bằng email thật -> Cập nhật Role và Team
      await prismaCloud.user.update({
        where: { id: cloudByEmail.id },
        data: {
          roles: localU.roles,
          team: localU.team,
          full_name: localU.full_name,
        }
      });
      updatedCounter++;
    } else {
      // 2. Không tìm thấy email thật trên Cloud -> Tìm xem trên Cloud có account ảo '@employee...' nào trùng full_name không?
      const cloudByNameFake = cloudUsers.find(
        cu => cu.full_name.toLowerCase() === localU.full_name.toLowerCase() 
           && cu.email.endsWith('@employee.vcb.internal')
      );

      if (cloudByNameFake) {
        console.log(`Tìm thấy user ảo: ${cloudByNameFake.email} -> thay thế thành email thật: ${localU.email}`);
        // Cập nhật đè email xịn và role
        await prismaCloud.user.update({
          where: { id: cloudByNameFake.id },
          data: {
            email: localU.email, // THAY MAIL ẢO THÀNH MAIL THẬT!
            roles: localU.roles,
            team: localU.team,
            password_hash: localU.password_hash,
          }
        });
        updatedCounter++;
      } else {
        // 3. Hoàn toàn không tìm thấy ai trùng email hay trùng tên -> Tạo mới (Upsert by email)
        try {
          await prismaCloud.user.create({
            data: {
              ...userData,
              manager_id: null,
              team_leader_id: null
            }
          });
          createdCounter++;
        } catch(e) {
          console.error(`Không thể tạo mới ${localU.email}:`, e.message);
        }
      }
    }
  }

  console.log(`\n✅ ĐỒNG BỘ THÀNH CÔNG: Đã Cập nhật ${updatedCounter} Users, Tạo mới ${createdCounter} Users!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaLocal.$disconnect();
    await prismaCloud.$disconnect();
  });
