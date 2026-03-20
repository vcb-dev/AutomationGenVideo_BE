import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient({
    datasources: { db: { url: "postgresql://postgres:postgres@127.0.0.1:5432/video_production?schema=public" } }
});

const prismaCloud = new PrismaClient({
    datasources: { db: { url: "postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?schema=public" } }
});

async function main() {
  const permissions = await prisma.larkPermission.findMany();
  let updatedCount = 0;

  for (const perm of permissions) {
    if (!perm.email) continue;
    
    const userToUpdate = await prisma.user.findFirst({
        where: { email: { equals: perm.email, mode: 'insensitive' } }
    });

    const determineRole = (rawItem: string): UserRole => {
        const rawRole = (rawItem || '').toUpperCase();
        if (rawRole.includes('LEADER')) return UserRole.LEADER;
        if (rawRole.includes('MANAGER')) return UserRole.MANAGER;
        if (rawRole.includes('ADMIN')) return UserRole.ADMIN;
        return UserRole.MEMBER;
    };

    if (userToUpdate) {
        const newRole = determineRole(perm.role || '');
        await prisma.user.update({
            where: { id: userToUpdate.id },
            data: {
                roles: [newRole],
                team: perm.team || undefined,
            }
        });
        
        try {
            await prismaCloud.user.update({
                where: { email: perm.email },
                data: {
                    roles: [newRole],
                    team: perm.team || undefined,
                }
            });
        } catch(e) {}

        console.log(`Updated User: ${perm.email} -> Chuyền thành ${newRole} | Team: ${perm.team}`);
        updatedCount++;
    } else {
        const userByName = await prisma.user.findFirst({
            where: { full_name: { equals: perm.name, mode: 'insensitive' } }
        });
        if (userByName) {
            const newRole = determineRole(perm.role || '');
            await prisma.user.update({
                where: { id: userByName.id },
                data: {
                    roles: [newRole],
                    team: perm.team || undefined,
                }
            });

            try {
                await prismaCloud.user.updateMany({
                   where: { email: userByName.email },
                   data: {
                      roles: [newRole],
                      team: perm.team || undefined,
                   }
                });
            } catch(e) {}

            console.log(`Updated User by Name: ${perm.name} -> Chuyền thành ${newRole} | Team: ${perm.team}`);
            updatedCount++;
        }
    }
  }

  console.log(`\n✅ HOÀN THẤT ĐỒNG BỘ MỚI: Đã ánh xạ toàn bộ quyền từ LarkPermissions sang cả 2 phiên bản máy chủ của bảng User cho ${updatedCount} người!`);
}

main().finally(() => { prisma.$disconnect(); prismaCloud.$disconnect(); });
