const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    console.log('Resetting employee_status for haducbaoviet0911@gmail.com');
    // Fix: reset employee_status for the active Google login account 
    const updated = await prisma.user.updateMany({
        where: { email: { equals: 'haducbaoviet0911@gmail.com', mode: 'insensitive' } },
        data: { 
            employee_status: null,
            // Also set the team from KPI data (Global - JP1)
            team: 'Global - JP1'
        }
    });
    console.log('\nFixed active records:', updated.count);
    
    // Also fix the old account if it exists
    const oldFixed = await prisma.user.updateMany({
        where: { 
            email: { equals: 'haducbaoviet@gmail.com', mode: 'insensitive' },
        },
        data: { employee_status: null }
    });
    console.log('Fixed old records:', oldFixed.count);
    
    await prisma.$disconnect();
}
run().catch(console.error);
