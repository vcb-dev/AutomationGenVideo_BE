const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const deleted = await prisma.larkReport.deleteMany({});
    console.log('Successfully cleared', deleted.count, 'rows in larkReport.');
    await prisma.$disconnect();
}
run().catch(console.error);
