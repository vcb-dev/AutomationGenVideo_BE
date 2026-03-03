
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log('🔄 Updating database records to use combined LEADER role...');

        // 1. Get all users
        const users = await prisma.user.findMany();
        let updatedCount = 0;

        for (const user of users) {
            let roles = user.roles || [];
            let needsUpdate = false;

            const updatedRoles = roles.map(role => {
                if (role === 'LEADER_VIDEO' || role === 'LEADER_CONTENT') {
                    needsUpdate = true;
                    return 'LEADER';
                }
                return role;
            });

            if (needsUpdate) {
                // Remove duplicates in case they had both roles
                const uniqueRoles = Array.from(new Set(updatedRoles));

                await prisma.user.update({
                    where: { id: user.id },
                    data: { roles: uniqueRoles }
                });
                updatedCount++;
                console.log(`✅ Updated roles for user: ${user.email}`);
            }
        }

        console.log(`✨ Successfully updated ${updatedCount} users.`);
    } catch (error) {
        console.error('❌ Error updating roles:', error);
    } finally {
        await prisma.$disconnect();
    }
}

run();
