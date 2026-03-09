
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateRoles() {
  const users = await prisma.user.findMany({
    select: { id: true, roles: true, email: true }
  });

  console.log(`Checking ${users.length} users...`);

  for (const user of users) {
    const originalRoles = user.roles as string[];
    const newRoles: UserRole[] = originalRoles.map(r => {
      if (r === 'LEADER' || r === 'EDITOR' || r === 'CONTENT') return UserRole.MEMBER;
      if (r === 'ADMIN') return UserRole.ADMIN;
      if (r === 'MANAGER') return UserRole.MANAGER;
      return UserRole.MEMBER;
    });

    const hasChange = JSON.stringify(originalRoles) !== JSON.stringify(newRoles);
    if (hasChange) {
      console.log(`Updating roles for ${user.email}: [${originalRoles.join(', ')}] -> [${newRoles.join(', ')}]`);
      await prisma.user.update({
        where: { id: user.id },
        data: { roles: newRoles }
      });
    }
  }

  const permissions = await prisma.rolePermission.findMany();
  const memberPerm = await prisma.rolePermission.findUnique({ where: { role: UserRole.MEMBER } });
  let memberMenuIds = memberPerm ? memberPerm.menu_ids : [];

  for (const perm of permissions) {
    const r = perm.role as string;
    if (r === 'LEADER' || r === 'EDITOR' || r === 'CONTENT') {
      console.log(`Merging RolePermission for ${r} into MEMBER...`);
      memberMenuIds = Array.from(new Set([...memberMenuIds, ...perm.menu_ids]));
      await prisma.rolePermission.delete({ where: { role: perm.role } });
    }
  }

  if (memberMenuIds.length > 0) {
    await prisma.rolePermission.upsert({
      where: { role: UserRole.MEMBER },
      update: { menu_ids: memberMenuIds },
      create: { role: UserRole.MEMBER, menu_ids: memberMenuIds }
    });
  }

  console.log('Migration done.');
  await prisma.$disconnect();
}

migrateRoles().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
