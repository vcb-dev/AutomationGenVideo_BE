const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const permissions = [
        {
            role: 'ADMIN',
            menu_ids: ['performance', 'dashboard', 'editors', 'facebook', 'instagram', 'tiktok', 'douyin', 'xiaohongshu', 'settings', 'permissions'],
        },
        {
            role: 'MANAGER',
            menu_ids: ['performance', 'dashboard', 'editors', 'facebook', 'instagram', 'tiktok', 'douyin', 'xiaohongshu', 'settings'],
        },
        {
            role: 'LEADER',
            menu_ids: ['performance', 'facebook', 'instagram', 'tiktok', 'douyin', 'xiaohongshu'],
        },
        {
            role: 'EDITOR',
            menu_ids: ['performance', 'facebook', 'instagram', 'tiktok', 'douyin', 'xiaohongshu'],
        },
        {
            role: 'CONTENT',
            menu_ids: ['performance', 'facebook', 'instagram', 'tiktok', 'douyin', 'xiaohongshu'],
        },
    ];

    for (const p of permissions) {
        await prisma.rolePermission.upsert({
            where: { role: p.role },
            update: { menu_ids: p.menu_ids },
            create: { role: p.role, menu_ids: p.menu_ids },
        });
    }

    console.log('Seed successful!');
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
