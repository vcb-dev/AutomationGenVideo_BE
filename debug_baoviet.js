const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    // Check larkKPI
    const kpis = await prisma.larkKPI.findMany();
    const bv = kpis.find(k => k.name && k.name.toUpperCase().includes('BẢO VIỆT'));
    console.log('Total KPI records:', kpis.length);
    if (bv) {
        console.log('BẢO VIỆT in larkKPI:');
        console.log('  name:', bv.name);
        console.log('  email:', bv.email);
        console.log('  team:', bv.team);
        console.log('  month:', bv.month);
        console.log('  state:', bv.state);
        console.log('  employee_status:', bv.employee_status);
    } else {
        console.log('BẢO VIỆT NOT FOUND in larkKPI');
    }
    
    // Check larkPermission
    const perms = await prisma.$queryRawUnsafe('SELECT name, email, role, team FROM "lark_permissions" WHERE "name" ILIKE \'%việt%\' OR "email" ILIKE \'%baoviet%\'');
    console.log('Permissions for BẢO VIỆT:', perms);

    // Check user table
    const users = await prisma.user.findMany({ where: { email: { contains: 'baoviet', mode: 'insensitive' } } });
    console.log('Users with baoviet email:', users.map(u => ({ email: u.email, full_name: u.full_name, roles: u.roles, team: u.team })));
    
    await prisma.$disconnect();
}
run().catch(console.error);
