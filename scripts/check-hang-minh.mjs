import { PrismaClient } from '@prisma/client';

const local = new PrismaClient();

async function main() {
    // Check local DB for Hang Minh KPI around 12/04
    const kpis = await local.larkKPI.findMany({
        where: {
            name: { contains: 'Minh', mode: 'insensitive' },
            team: { contains: 'JP1', mode: 'insensitive' },
        },
        orderBy: { report_date: 'desc' },
        take: 30,
    });

    console.log(`\n=== Local DB: KPI records for *Minh* in *JP1* (${kpis.length} rows) ===`);
    for (const k of kpis) {
        console.log(`  ${k.name} | team=${k.team} | month=${k.month} | report_date=${k.report_date?.toISOString().slice(0,10)} | kpi_day=${k.kpi_day} | completed_day=${k.completed_day} | kpi_month=${k.kpi_month} | completed_month=${k.completed_month} | traffic=${k.traffic_month} | revenue=${k.revenue_month}`);
    }

    // Also search by name more broadly
    const kpis2 = await local.larkKPI.findMany({
        where: {
            name: { contains: 'Hằng Minh', mode: 'insensitive' },
        },
        orderBy: { report_date: 'desc' },
        take: 20,
    });
    console.log(`\n=== Local DB: KPI for "Hằng Minh" (${kpis2.length} rows) ===`);
    for (const k of kpis2) {
        console.log(`  ${k.name} | team=${k.team} | month=${k.month} | report_date=${k.report_date?.toISOString().slice(0,10)} | kpi_day=${k.kpi_day} | completed_day=${k.completed_day}`);
    }

    // Try without diacritics
    const kpis3 = await local.larkKPI.findMany({
        where: {
            name: { contains: 'Hang Minh', mode: 'insensitive' },
        },
        orderBy: { report_date: 'desc' },
        take: 20,
    });
    console.log(`\n=== Local DB: KPI for "Hang Minh" (${kpis3.length} rows) ===`);
    for (const k of kpis3) {
        console.log(`  ${k.name} | team=${k.team} | month=${k.month} | report_date=${k.report_date?.toISOString().slice(0,10)} | kpi_day=${k.kpi_day} | completed_day=${k.completed_day}`);
    }

    // Check server DB too
    const SERVER_URL = 'postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?sslmode=require&schema=public&connection_limit=10';
    const server = new PrismaClient({ datasources: { db: { url: SERVER_URL } } });

    const serverKpis = await server.larkKPI.findMany({
        where: {
            name: { contains: 'Minh', mode: 'insensitive' },
            team: { contains: 'JP1', mode: 'insensitive' },
        },
        orderBy: { report_date: 'desc' },
        take: 30,
    });
    console.log(`\n=== Server DB: KPI for *Minh* in *JP1* (${serverKpis.length} rows) ===`);
    for (const k of serverKpis) {
        console.log(`  ${k.name} | team=${k.team} | month=${k.month} | report_date=${k.report_date?.toISOString().slice(0,10)} | kpi_day=${k.kpi_day} | completed_day=${k.completed_day} | kpi_month=${k.kpi_month} | completed_month=${k.completed_month} | traffic=${k.traffic_month} | revenue=${k.revenue_month}`);
    }

    await local.$disconnect();
    await server.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
