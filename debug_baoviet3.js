const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const reports = await prisma.larkReport.findMany();
    const bv = reports.find(r => r.name && r.name.toUpperCase().includes('BẢO VIỆT'));
    if (bv) {
        console.log('Report fields:');
        console.log('  name:', bv.name);
        console.log('  email:', bv.email);  // <-- This is crucial
        console.log('  team:', bv.team);
        console.log('  date:', bv.date);
        console.log('  id:', bv.id);
    }
    await prisma.$disconnect();
}
run().catch(console.error);
