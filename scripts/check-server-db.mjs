import { PrismaClient } from '@prisma/client';

const SERVER_URL = 'postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?sslmode=require&schema=public&connection_limit=5';
const db = new PrismaClient({ datasources: { db: { url: SERVER_URL } } });

async function main() {
    const count = await db.larkKPI.count();
    const chung = await db.larkKPI.findMany({
        where: { name: { contains: 'Chung', mode: 'insensitive' } },
        select: { name: true, team: true, month: true, employee_id: true },
        orderBy: { report_date: 'desc' },
        take: 5
    });
    console.log(`Server lark_kpi total: ${count}`);
    console.log('Chung Do on server:');
    chung.forEach(k => console.log(`  ${k.name?.trim()} | team="${k.team}" | month=${k.month} | emp_id=${k.employee_id}`));
}

main().finally(() => db.$disconnect());
