
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    const videoCount = await prisma.video_management_scrapedvideo.count();
    const taskCount = await prisma.larkListTask.count();
    const taskWithLinkCount = await prisma.larkListTask.count({
        where: { link_tiktok: { not: null } }
    });
    console.log(`Scraped Video Count: ${videoCount}`);
    console.log(`Lark List Task Count: ${taskCount}`);
    console.log(`Task With Link Count: ${taskWithLinkCount}`);
}
run().catch(console.error).finally(() => prisma.$disconnect());
