const resp = await fetch('http://localhost:3000/api/lark/user-activity?date=2026-04-12&team=Global%20-%20JP1&timeType=yesterday');
const data = await resp.json();

console.log('Top-level keys:', Object.keys(data));

// Check reports
if (data.reports) {
    console.log('\nTotal reports:', data.reports.length);
    for (const r of data.reports) {
        if (r.name?.includes('Minh') || r.userName?.includes('Minh')) {
            console.log('\n=== Hằng Minh report ===');
            console.log(JSON.stringify(r, null, 2));
        }
    }
    // Show all report names
    console.log('\nAll report names:');
    for (const r of data.reports) {
        const n = r.name || r.userName || 'N/A';
        console.log(`  ${n} | dailyGoal=${r.dailyGoal} | done=${r.done} | team=${r.team} | traffic=${r.traffic} | revenue=${r.revenue}`);
    }
}

// Check summary
if (data.summary) {
    console.log('\n=== Summary ===');
    console.log(JSON.stringify(data.summary, null, 2));
}
