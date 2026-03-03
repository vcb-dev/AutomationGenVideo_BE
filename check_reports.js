
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    console.log('Fetching latest Lark Reports...');
    try {
        const reports = await prisma.larkReport.findMany({
            take: 3,
            orderBy: { date: 'desc' }
        });
        if (reports.length > 0) {
            reports.forEach((r, i) => {
                console.log(`--- Report ${i + 1} (${r.name}) ---`);
                console.log('Answers keys:', Object.keys(r.answers || {}));
                console.log('Traffic answer:', r.answers ? r.answers['Bạn đã đạt bao nhiêu traffic cho video mới?'] : 'N/A');
                console.log('Revenue answer:', r.answers ? r.answers['Bạn đã đạt doanh thu của bao nhiêu video?'] : 'N/A');
            });
        } else {
            console.log('No reports found.');
        }
    } catch (e) {
        console.error(e);
    }
}
run().finally(() => prisma.$disconnect());
