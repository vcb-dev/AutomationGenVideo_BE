const { PrismaClient } = require('@prisma/client');
const prismaLocal = new PrismaClient();
const prismaRemote = new PrismaClient({
    datasources: { db: { url: "postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?schema=public" } }
});

async function main() {
    console.log("Checking LarkReports in Local DB...");
    const reportsLocal = await prismaLocal.larkReport.count();
    console.log("Local Report Count: " + reportsLocal);

    console.log("Checking LarkReports in Remote DB...");
    const reportsRemote = await prismaRemote.larkReport.count();
    console.log("Remote Report Count: " + reportsRemote);
}

main().catch(console.error).finally(async () => {
    await prismaLocal.$disconnect();
    await prismaRemote.$disconnect();
});
