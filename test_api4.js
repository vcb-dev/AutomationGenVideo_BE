const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const reports = await prisma.larkReport.findMany();
    console.log('Total reports:', reports.length);
    const bv = reports.find(r => r.name && r.name.toLowerCase().includes('việt') || r.email && r.email.toLowerCase().includes('việt'));
    console.log(bv);
    await prisma.$disconnect();
}
run();
