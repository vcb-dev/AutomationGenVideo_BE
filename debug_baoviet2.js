const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Replicate the core logic of getUserActivityReports to find where Bảo Việt gets dropped
async function run() {
    const today = new Date('2026-03-23');
    const startOfDay = new Date(Date.UTC(2026, 2, 22, 17, 0, 0, 0)); // 2026-03-23 UTC+7
    const endOfDay   = new Date(Date.UTC(2026, 2, 23, 16, 59, 59, 999));
    
    const monthsInRange = [{ monthNum: 3, year: 2026, formats: ['T3', 'T03', 'Tháng 3', 'tháng 3', 'Thang 3', 'thang 3', '3', 'Mar', 'March'] }];

    // Fetch KPIs only for March
    const kpiData = await prisma.larkKPI.findMany({
        where: {
            OR: [
                { month: { in: monthsInRange.flatMap(m => m.formats) } },
            ],
            state: { not: 'off' },
        }
    });
    console.log('kpiData count (month T3):', kpiData.length);
    const bvInKpi = kpiData.find(k => k.name && k.name.toUpperCase().includes('BẢO VIỆT'));
    console.log('BẢO VIỆT in kpiData (T3 only):', bvInKpi ? 'FOUND' : 'NOT FOUND - Expected: Their KPI is T1!');

    // Now check reports
    const reports = await prisma.larkReport.findMany({
        where: { date: { gte: startOfDay, lte: endOfDay } }
    });
    console.log('Reports for today:', reports.length);
    const bvReport = reports.find(r => r.name && r.name.toUpperCase().includes('BẢO VIỆT'));
    console.log('BẢO VIỆT report today:', bvReport ? `FOUND - id: ${bvReport.id}` : 'NOT FOUND');
    
    // Simulate kpisForAggregation building
    const kpisForAggregation = new Map();
    const nameToPersonKey = new Map();
    
    kpiData.forEach(kpi => {
        const nameKey = kpi.name ? kpi.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') : null;
        const trimmedEmpId = kpi.employee_id?.trim();
        const personKey = trimmedEmpId || nameKey || kpi.id;
        if (nameKey) nameToPersonKey.set(nameKey, personKey);
        const personMonthKey = `${personKey}_T3_2026`;
        if (!kpisForAggregation.has(personMonthKey)) {
            kpisForAggregation.set(personMonthKey, { ...kpi });
        }
    });
    
    console.log('\nkpisForAggregation after KPI step:', kpisForAggregation.size);
    
    // Now add from reports (fallback)
    reports.forEach(r => {
        const nameKey = r.name ? r.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') : null;
        const emailKey = r.email?.toLowerCase().trim();
        const personKey = nameKey ? (nameToPersonKey.get(nameKey) || nameKey) : emailKey;
        const reportMonthNum = 3;
        const reportYear = 2026;
        const personMonthKey = `${personKey}_${reportMonthNum}_${reportYear}`;
        
        if (!kpisForAggregation.has(personMonthKey)) {
            kpisForAggregation.set(personMonthKey, {
                id: `report_${r.id}`,
                name: r.name || r.email,
                email: r.email,
                team: r.team || 'Khác',
                kpi_day: 0,
            });
            console.log(`\nAdded from report fallback: key=${personMonthKey}, name=${r.name}`);
        } else {
            console.log(`\nReport ${r.name} already in kpisForAggregation (key=${personMonthKey})`);
        }
    });

    console.log('\nkpisForAggregation after report fallback:', kpisForAggregation.size);
    const bvInMap = [...kpisForAggregation.entries()].find(([k, v]) => v.name && v.name.toUpperCase().includes('BẢO VIỆT'));
    console.log('BẢO VIỆT in kpisForAggregation:', bvInMap ? `YES - key: ${bvInMap[0]}` : 'NO');
    
    await prisma.$disconnect();
}
run().catch(console.error);
