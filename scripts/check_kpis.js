const { PrismaClient } = require('@prisma/client');
const prismaLocal = new PrismaClient();
const prismaRemote = new PrismaClient({
    datasources: { db: { url: "postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?schema=public" } }
});

async function main() {
    console.log("Checking KPIs in Local DB...");
    const kpiLocal = await prismaLocal.larkKPI.count();
    console.log("Local KPI Count: " + kpiLocal);

    console.log("Checking KPIs in Remote DB...");
    const kpiRemote = await prismaRemote.larkKPI.count();
    console.log("Remote KPI Count: " + kpiRemote);
}

main().catch(console.error).finally(async () => {
    await prismaLocal.$disconnect();
    await prismaRemote.$disconnect();
});
