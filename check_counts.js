
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const kpiCount = await prisma.larkKPI.count();
    const reportsCount = await prisma.larkReport.count();
    const employeesCount = await prisma.larkEmployee.count();
    const channelsCount = await prisma.channel.count();

    console.log(`Counts in DB:`);
    console.log(`- LarkKPI: ${kpiCount}`);
    console.log(`- LarkReport: ${reportsCount}`);
    console.log(`- LarkEmployee: ${employeesCount}`);
    console.log(`- Channel: ${channelsCount}`);

    const latestKpis = await prisma.larkKPI.findMany({
        orderBy: { report_date: 'desc' },
        take: 5
    });
    console.log('Latest 5 KPI Report Dates:');
    latestKpis.forEach(k => console.log(`${k.name}: ${k.report_date ? k.report_date.toISOString() : 'null'} (Month: ${k.month})`));

    process.exit(0);
}

check();
