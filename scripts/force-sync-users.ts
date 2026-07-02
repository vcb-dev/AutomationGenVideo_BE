import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log('Fetching all records from report_permissions...');
    const permissions = await prisma.reportPermission.findMany();
    console.log(`Found ${permissions.length} records. Forcing into users table...`);

    let created = 0;
    let updated = 0;

    for (const perm of permissions) {
        // Try to find email
        let email = perm.email?.trim().toLowerCase() || null;
        
        let avatarUrl = null;
        let empId = null;
        if (perm.employee) {
            try {
                const empObj = typeof perm.employee === 'string' ? JSON.parse(perm.employee) : perm.employee;
                if (Array.isArray(empObj) && empObj.length > 0) {
                    avatarUrl = empObj[0].avatar_url || null;
                    empId = empObj[0].id || null;
                    if (!email && empObj[0].email) email = empObj[0].email.trim().toLowerCase();
                }
            } catch (e) {}
        }

        const roleLower = (perm.role || '').toLowerCase().trim();
        let userRoles: any[] = ['MEMBER'];
        if (roleLower === 'admin') userRoles = ['ADMIN'];
        else if (roleLower === 'manager') userRoles = ['MANAGER'];
        else if (roleLower === 'leader') userRoles = ['LEADER'];

        const fullName = perm.name || email?.split('@')[0] || 'Unknown';
        const team = perm.team || null;
        const status = perm.status || null;

        // Try to find existing user by email, or by name if email is fake
        let existingUser = null;
        if (email) {
            existingUser = await prisma.user.findFirst({
                where: { email: { equals: email, mode: 'insensitive' } }
            });
        }
        if (!existingUser && perm.name) {
             existingUser = await prisma.user.findFirst({
                where: { full_name: { equals: perm.name.trim(), mode: 'insensitive' } }
            });
        }

        // if still no email, gracefully create a dummy email based on name
        const finalEmail = email || `${fullName.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now()}@noemail.com`;

        if (existingUser) {
            await prisma.user.update({
                where: { id: existingUser.id },
                data: {
                    roles: userRoles,
                    team: team,
                    employee_status: status,
                    employee_id: empId || existingUser.employee_id,
                    ...(avatarUrl ? { image_url: avatarUrl } : {}),
                    ...(email && !existingUser.email.includes('@noemail') && existingUser.email !== email ? { email } : {}) 
                }
            });
            updated++;
        } else {
            await prisma.user.create({
                data: {
                    email: finalEmail,
                    password_hash: null,
                    full_name: fullName.trim(),
                    roles: userRoles,
                    team: team,
                    employee_status: status,
                    employee_id: empId,
                    image_url: avatarUrl,
                    is_active: true
                }
            });
            created++;
        }
    }
    console.log(`Done! Created: ${created}, Updated: ${updated}`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
}).finally(async () => {
    await prisma.$disconnect();
});
