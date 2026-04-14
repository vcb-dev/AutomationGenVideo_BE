import fetch from 'node-fetch';

async function checkApi() {
    try {
        const res = await fetch("http://localhost:3000/api/lark/user-activity?startDate=2026-04-13&endDate=2026-04-13&team=Global+-+JP1");
        const data = await res.json();
        console.log("Reports count:", data.reports?.length);
        console.log("Names:", data.reports.map(r => r.name));
        console.log("Teams:", data.reports.map(r => r.team));
    } catch(err) {
        console.error(err);
    }
}
checkApi();
