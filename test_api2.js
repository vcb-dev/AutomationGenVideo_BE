const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const reports = await prisma.larkReport.findMany();
    const bv = reports.find(r => r.name && r.name.includes('BẢO'));
    console.log('bv.date:', bv.date);
    await prisma.$disconnect();
}
run();
