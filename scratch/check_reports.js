import fs from 'fs';
import fetch from 'node-fetch';

async function checkApi() {
    try {
        fs.writeFileSync('scratch/debug_logs.txt', '');
        console.log("Triggering API...");
        const res = await fetch("http://localhost:3000/api/lark/user-activity?startDate=2026-04-13&endDate=2026-04-13&team=Global+-+JP1");
        await res.json();
        console.log("Logs:");
        console.log(fs.readFileSync('scratch/debug_logs.txt', 'utf8'));
    } catch(err) {
        console.error(err);
    }
}
checkApi();
