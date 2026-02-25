const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    try {
        const total = await prisma.larkReport.count();
        console.log('Total LarkReports:', total);

        const latest = await prisma.larkReport.findMany({
            orderBy: { date: 'desc' },
            take: 5
        });
        console.log('Latest Reports Dates:', latest.map(l => l.date));

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayCount = await prisma.larkReport.count({
            where: {
                date: { gte: today, lt: tomorrow }
            }
        });
        console.log('Reports for Today (Feb 25):', todayCount);

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

check();
