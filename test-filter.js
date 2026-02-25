const targetMonthNum = 2;
const targetYear = 2026;
const monthFormats = ["T2", "Tháng 2", "tháng 2", "2", "02"];

const kpis = [
    { name: 'Test', month: 'T2', report_date: new Date("2026-02-24T17:17:56.000Z"), created_at: new Date() },
    { name: 'Wrong Year', month: 'T2', report_date: new Date("2025-02-24T17:17:56.000Z"), created_at: new Date() },
    { name: 'Wrong Month', month: 'T12', report_date: new Date("2026-02-24T17:17:56.000Z"), created_at: new Date() }
];

const filtered = kpis.filter(k => {
    if (!k.month) return false;
    // Year check
    const kDate = k.report_date || k.created_at;
    if (kDate) {
        const kYear = new Date(kDate).getFullYear();
        if (kYear !== targetYear) return false;
    }

    const m = k.month.trim();
    return monthFormats.some(fmt => {
        if (m === fmt) return true;
        const regex = new RegExp(`(^|\\D)${targetMonthNum}(\\D|$)`);
        return regex.test(m);
    });
});

console.log('Filtered Count:', filtered.length);
console.log('Filtered Names:', filtered.map(k => k.name));
