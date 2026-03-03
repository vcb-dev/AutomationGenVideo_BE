
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    // Find all records to check numeric fields
    const tasks = await prisma.larkListTask.findMany({ take: 100 });
    console.log('Fields and their values:');
    tasks.forEach(task => {
        Object.entries(task).forEach(([key, val]) => {
            if (typeof val === 'number' || (typeof val === 'string' && !isNaN(parseFloat(val)) && val.length > 5)) {
                console.log(`${key}: ${val}`);
            }
        });
    });
}
run().catch(console.error).finally(() => prisma.$disconnect());
