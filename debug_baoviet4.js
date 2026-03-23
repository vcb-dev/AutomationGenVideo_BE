const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const users = await prisma.user.findMany({ 
        where: { email: { contains: 'baoviet', mode: 'insensitive' } } 
    });
    for (const u of users) {
        console.log('email:', u.email);
        console.log('full_name:', u.full_name);
        console.log('roles:', u.roles);
        console.log('team:', u.team);
        console.log('employee_status:', u.employee_status);
        console.log('employee_id:', u.employee_id);
        console.log('state:', u.state);
        console.log('---');
    }
    
    await prisma.$disconnect();
}
run().catch(console.error);
