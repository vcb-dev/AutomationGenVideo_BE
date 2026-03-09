
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function migrateRoles() {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, roles: true, email: true }
    });

    console.log(`Checking ${users.length} users...`);

    for (const user of users) {
      const originalRoles = user.roles;
      const newRoles = originalRoles.map(r => {
        if (r === 'LEADER' || r === 'EDITOR' || r === 'CONTENT') return 'MEMBER';
        return r;
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
    // Use string comparisons for role to avoid enum issues
    const memberPerm = permissions.find(p => p.role === 'MEMBER');
    let memberMenuIds = memberPerm ? memberPerm.menu_ids : [];

    for (const perm of permissions) {
      const r = perm.role;
      if (r === 'LEADER' || r === 'EDITOR' || r === 'CONTENT') {
        console.log(`Merging RolePermission for ${r} into MEMBER...`);
        memberMenuIds = Array.from(new Set([...memberMenuIds, ...perm.menu_ids]));
        await prisma.rolePermission.delete({ where: { role: perm.role } });
      }
    }

    if (memberMenuIds.length > 0) {
      await prisma.rolePermission.upsert({
        where: { role: 'MEMBER' },
        update: { menu_ids: memberMenuIds },
        create: { role: 'MEMBER', menu_ids: memberMenuIds }
      });
    }

    console.log('Migration done.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

migrateRoles();
