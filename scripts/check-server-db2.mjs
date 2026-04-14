import { PrismaClient } from '@prisma/client';

const SERVER_URL = 'postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?sslmode=require&schema=public&connection_limit=5';
const db = new PrismaClient({ datasources: { db: { url: SERVER_URL } } });

async function main() {
    const count = await db.larkKPI.count();
    console.log(`Server lark_kpi total: ${count}`);

    const chung = await db.larkKPI.findMany({
        where: { name: { contains: 'Chung', mode: 'insensitive' } },
        select: { name: true, team: true, month: true, employee_id: true, report_date: true },
        orderBy: { report_date: 'desc' },
        take: 10
    });
    console.log(`\nChung Do records (${chung.length}):`);
    chung.forEach(k => console.log(`  ${k.name?.trim()} | team="${k.team}" | month=${k.month} | date=${k.report_date?.toISOString().slice(0,10)} | emp_id=${k.employee_id}`));

    // Check if any JP1 records for Chung exist
    const chungJp1 = await db.larkKPI.count({
        where: { name: { contains: 'Chung', mode: 'insensitive' }, team: { contains: 'JP1', mode: 'insensitive' } }
    });
    const chungDL = await db.larkKPI.count({
        where: { name: { contains: 'Chung', mode: 'insensitive' }, team: { contains: 'Loan', mode: 'insensitive' } }
    });
    console.log(`\nChung Do JP1: ${chungJp1}, Dai Loan: ${chungDL}`);

    // Total by recent date to check if cron already ran
    const latest = await db.larkKPI.findMany({ orderBy: { report_date: 'desc' }, take: 3, select: { name: true, team: true, report_date: true, month: true } });
    console.log('\nLatest 3 records in server DB:');
    latest.forEach(k => console.log(`  ${k.name?.trim()} | team="${k.team}" | date=${k.report_date?.toISOString().slice(0,10)} | month=${k.month}`));
}

main().finally(() => db.$disconnect());
