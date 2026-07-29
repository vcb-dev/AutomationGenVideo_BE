import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log("=== BROAD SEARCH FOR 'KHUE' IN DB ===");
    
    // 1. Search in User
    const users = await prisma.user.findMany({
        where: {
            OR: [
                { full_name: { contains: 'khue', mode: 'insensitive' } },
                { email: { contains: 'khue', mode: 'insensitive' } }
            ]
        }
    });
    console.log("Found in users:", users.map(u => ({ id: u.id, email: u.email, full_name: u.full_name, team: u.team })));

    // 2. Search in ReportPermission
    const permissions = await prisma.reportPermission.findMany({
        where: {
            OR: [
                { name: { contains: 'khue', mode: 'insensitive' } },
                { email: { contains: 'khue', mode: 'insensitive' } }
            ]
        }
    });
    console.log("Found in report_permissions:", permissions.map(p => ({ id: p.id, email: p.email, name: p.name })));

    // 3. Search in ChecklistReport
    const reports = await prisma.checklistReport.findMany({
        where: {
            OR: [
                { name: { contains: 'khue', mode: 'insensitive' } },
                { email: { contains: 'khue', mode: 'insensitive' } }
            ]
        }
    });
    console.log("Found in checklist_reports (first 5):", reports.slice(0, 5).map(r => ({ id: r.id, email: r.email, name: r.name })));

    // 4. Search in Kpi
    const kpi = await prisma.kpi.findMany({
        where: {
            name: { contains: 'khue', mode: 'insensitive' }
        }
    });
    console.log("Found in kpi (first 5):", kpi.slice(0, 5).map(k => ({ id: k.id, name: k.name, employee_id: k.employee_id })));

    // 5. Search in Channel
    const channels = await prisma.channel.findMany({
        where: {
            OR: [
                { owner: { contains: 'khue', mode: 'insensitive' } },
                { email: { contains: 'khue', mode: 'insensitive' } }
            ]
        }
    });
    console.log("Found in channels (first 5):", channels.slice(0, 5).map(c => ({ id: c.id, name: c.name, owner: c.owner, email: c.email })));
}

main().finally(() => prisma.$disconnect());
