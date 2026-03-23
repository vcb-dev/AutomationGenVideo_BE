const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const filters = {};
    const requesterEmail = 'haducbaoviet0911@gmail.com';
    let requesterRole = 'Member';
    let requesterTeam = null;

    // Simulate lines 1555+
    const sysUser = await prisma.user.findFirst({
        where: { email: { equals: requesterEmail, mode: 'insensitive' } }
    });
    if (sysUser) {
        if (sysUser.roles.some(r => r === 'MANAGER' || r === 'ADMIN' || r === 'MEMBER')) {
            requesterRole = sysUser.roles.includes('ADMIN') ? 'admin' :
                sysUser.roles.includes('MANAGER') ? 'manager' : 'member';
        }
        if (sysUser.team) {
            requesterTeam = sysUser.team;
        }
    }

    console.log('Role:', requesterRole, 'Team:', requesterTeam);
    const isInternalAdmin = requesterRole === 'admin' || requesterRole === 'manager';

    const dailyReports = await prisma.larkReport.findMany();
    
    // Simulate kpisForAggregation fallback build
    const kpisForAggregation = new Map();
    const nameToPersonKey = new Map();
    const employeeMap = new Map(); // empty

    const reportsMap = new Map();
    dailyReports.forEach(r => {
        let nameKey = r.name ? r.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') : null;
        const emailKey = r.email?.toLowerCase().trim();
        
        if (nameKey) {
            reportsMap.set(nameKey, { ...r });
        }
        if (emailKey && !reportsMap.has(emailKey)) {
            reportsMap.set(emailKey, { ...r });
        }
        
        if (nameKey || emailKey) {
            const personKey = nameKey ? (nameToPersonKey.get(nameKey) || nameKey) : emailKey;
            const reportMonthNum = (r.date ? new Date(r.date) : new Date()).getMonth() + 1;
            const reportYear = (r.date ? new Date(r.date) : new Date()).getFullYear();
            const personMonthKey = `${personKey}_${reportMonthNum}_${reportYear}`;

            if (!kpisForAggregation.has(personMonthKey)) {
                kpisForAggregation.set(personMonthKey, {
                    id: `report_${r.id}`,
                    employee_id: null,
                    name: r.name || r.email,
                    email: r.email,
                    team: r.team || 'Khác',
                    kpi_day: 0
                });
            }
        }
    });

    console.log('kpisForAggregation size:', kpisForAggregation.size);

    const allResults = Array.from(kpisForAggregation.values()).map(kpi => {
        const nameKey = kpi.name?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') || '';
        if (!nameKey || nameKey === 'unknown') {
            console.log('Dropped at nameKey guard:', kpi.name);
            return null;
        }

        const emailKey = kpi.email?.toLowerCase().trim();
        const report = reportsMap.get(nameKey) || reportsMap.get(emailKey);

        const personEmailForSelf = report?.email || kpi.email;
        const isSelf = personEmailForSelf && personEmailForSelf.toLowerCase().trim() === requesterEmail.toLowerCase().trim();

        const effectiveTeam = report?.team || kpi.team || 'Khác';
        let isMatchForRanking = true; // since teamFilterRaw is null

        const isAuthorizedForReport = isMatchForRanking || isSelf;

        if (!isMatchForRanking && !isAuthorizedForReport) {
            console.log('Dropped at isMatchForRanking guard:', kpi.name);
            return null;
        }

        return {
            name: kpi.name,
            team: effectiveTeam,
            isAuthorizedForReport,
            isMatchForRanking
        };
    });

    console.log('allResults mapped length:', allResults.filter(r => r !== null).length);
    console.log('Is Bảo Việt in results?', allResults.filter(r => r && r.name && r.name.includes('BẢO VIỆT')));
}
run();
