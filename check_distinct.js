
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    const teams = await prisma.larkKPI.findMany({ select: { team: true }, distinct: ['team'] });
    console.log('Teams:', teams.map(t => t.team));
    const contentTypes = await prisma.larkListTask.findMany({ select: { content_type: true }, distinct: ['content_type'] });
    console.log('Content Types (Tuyến):', contentTypes.map(c => c.content_type));
}
run().catch(console.error).finally(() => prisma.$disconnect());
