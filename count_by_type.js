
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    const counts = await prisma.larkListTask.groupBy({
        by: ['content_type'],
        _count: { id: true }
    });
    console.log('Video Counts by Type:', counts);
}
run().catch(console.error).finally(() => prisma.$disconnect());
