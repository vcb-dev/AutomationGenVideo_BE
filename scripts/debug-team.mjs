import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
    datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:5432/video_production?schema=public' } }
});

async function main() {
    // 1. ALL Chung Đỗ records in kpi - check team per month
    const chungKpis = await db.kpi.findMany({
        where: { name: { contains: 'Chung', mode: 'insensitive' } },
        select: { id: true, name: true, team: true, employee_id: true, month: true, report_date: true, state: true, employee_status: true },
        orderBy: { report_date: 'desc' }
    });
    console.log(`\n=== ALL kpi for "Chung" (${chungKpis.length} rows) ===`);
    chungKpis.forEach(k => console.log(`  ${k.name?.trim()} | team="${k.team}" | month=${k.month} | date=${k.report_date?.toISOString().slice(0,10)} | emp_id=${k.employee_id} | state=${k.state}`));

    // 2. All leaders in kpi for Global-JP1
    const jp1Leaders = await db.kpi.findMany({
        where: { team: { contains: 'JP1', mode: 'insensitive' } },
        select: { name: true, team: true, employee_id: true, month: true, state: true },
        distinct: ['name']
    });
    console.log(`\n=== Distinct people in kpi with team containing "JP1" (${jp1Leaders.length}) ===`);
    jp1Leaders.forEach(k => console.log(`  ${k.name?.trim()} | team="${k.team}" | emp_id=${k.employee_id} | month=${k.month} | state=${k.state}`));

    // 3. Check users table for roles
    const users = await db.user.findMany({
        where: { team: { contains: 'Global', mode: 'insensitive' } },
        select: { full_name: true, email: true, team: true, roles: true, employee_status: true },
        orderBy: { team: 'asc' }
    });
    console.log(`\n=== users table (Global teams) ===`);
    users.forEach(u => console.log(`  ${u.full_name} | team="${u.team}" | roles=${JSON.stringify(u.roles)} | status=${u.employee_status}`));

    // 4. How many records total match "Global - JP1"
    const jp1Count = await db.kpi.count({ where: { team: { contains: 'JP1', mode: 'insensitive' } } });
    const daiLoanCount = await db.kpi.count({ where: { team: { contains: 'Đài Loan', mode: 'insensitive' } } });
    const globalDLCount = await db.kpi.count({ where: { team: { contains: 'Global Đài', mode: 'insensitive' } } });
    console.log(`\n=== KPI counts by team ===`);
    console.log(`  JP1: ${jp1Count}, Đài Loan: ${daiLoanCount}, Global Đài: ${globalDLCount}`);
}

main().finally(() => db.$disconnect());
