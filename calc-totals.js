
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const currentMonth = 'T2';

    // Aggregate LarkKPI
    const kpiStats = await prisma.larkKPI.aggregate({
        where: { month: currentMonth },
        _sum: {
            completed_month: true,
            traffic_month: true,
            revenue_month: true
        },
        _count: { _all: true }
    });

    // Count HuykChannels
    const channelCount = await prisma.huykChannel.count();

    // For "Số lần BC", let's see how many reports were submitted in February
    const startOfMonth = new Date(2026, 1, 1);
    const endOfMonth = new Date(2026, 1, 28, 23, 59, 59);
    const reportCount = await prisma.larkReport.count({
        where: {
            date: {
                gte: startOfMonth,
                lte: endOfMonth
            }
        }
    });

    console.log('--- MONTHLY TOTALS (T2) ---');
    console.log('SỐ VIDEO:', kpiStats._sum.completed_month || 0);
    console.log('SỐ TRAFFIC:', (kpiStats._sum.traffic_month || 0).toString());
    console.log('SỐ DOANH THU:', (kpiStats._sum.revenue_month || 0).toString());
    console.log('SỐ KÊNH:', channelCount);
    console.log('SỐ LẦN BC (Feb):', reportCount);
    console.log('Total Team Members:', kpiStats._count._all);
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
