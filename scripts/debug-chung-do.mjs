import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
    datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:5432/video_production?schema=public' } }
});

async function main() {
    // 1. Find Chung Do in users table
    const users = await db.user.findMany({
        where: { full_name: { contains: 'Chung', mode: 'insensitive' } },
        select: { id: true, full_name: true, email: true, team: true, employee_id: true, employee_status: true }
    });
    console.log('\n=== users table (matching "Chung") ===');
    users.forEach(u => console.log(`  name="${u.full_name}" | email=${u.email} | team="${u.team}" | emp_id=${u.employee_id} | status=${u.employee_status}`));

    // 2. Find Chung Do in kpi
    const kpis = await db.kpi.findMany({
        where: { name: { contains: 'Chung', mode: 'insensitive' } },
        select: { id: true, name: true, team: true, employee_id: true, employee_status: true, state: true, month: true },
        orderBy: { report_date: 'desc' },
        take: 10
    });
    console.log('\n=== kpi table (matching "Chung") ===');
    kpis.forEach(k => console.log(`  name="${k.name}" | team="${k.team}" | emp_id=${k.employee_id} | status=${k.employee_status} | state=${k.state} | month=${k.month}`));
}

main().finally(() => db.$disconnect());
