import { readFileSync, writeFileSync } from 'fs';

const file = 'src/modules/lark-sync/lark.service.ts';
let lines = readFileSync(file, 'utf8').split('\n');

// Remove the two inserted blocks that are in wrong order
// Find and remove block 1: "Override allKpiInDb team with users.team"
let block1Start = -1, block1End = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Override allKpiInDb team with users.team')) { block1Start = i; }
    if (block1Start >= 0 && block1End < 0 && lines[i].trim() === '' && i > block1Start + 3) { block1End = i; break; }
}
if (block1Start >= 0) {
    lines.splice(block1Start, block1End - block1Start + 1);
    console.log(`Removed block1 (allKpiInDb override): lines ${block1Start+1}-${block1End+1}`);
}

// Find and remove block 2: "Override kpi.team with users.team (authoritative)"
let block2Start = -1, block2End = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Override kpi.team with users.team (authoritative)')) { block2Start = i - 1; } // include empty line before
    if (block2Start >= 0 && block2End < 0 && lines[i].trim() === '' && i > block2Start + 5) { block2End = i; break; }
}
if (block2Start >= 0) {
    lines.splice(block2Start, block2End - block2Start + 1);
    console.log(`Removed block2 (kpiData override): lines ${block2Start+1}-${block2End+1}`);
}

// Now find the right place: BEFORE "Build employee snapshot from larkKPI only"
let insertIdx = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Build employee snapshot from larkKPI only')) {
        insertIdx = i;
        break;
    }
}
console.log(`Will insert before line ${insertIdx + 1}`);

if (insertIdx >= 0) {
    const block = [
        '                // Fetch users.team to override stale lark_kpi.team data.',
        '                // Role: from users table. Team: from users table (authoritative over Lark).',
        '                const allUsersForTeam = await this.prisma.user.findMany({',
        '                    where: { is_active: true },',
        '                    select: { email: true, full_name: true, team: true }',
        '                });',
        '                const userTeamByEmail = new Map<string, string>();',
        '                const userTeamByName = new Map<string, string>();',
        '                for (const u of allUsersForTeam) {',
        "                    const t = (u.team || '').trim();",
        '                    if (!t) continue;',
        '                    if (u.email) userTeamByEmail.set(u.email.toLowerCase().trim(), t);',
        '                    if (u.full_name) { const nk = normName(u.full_name); if (nk) userTeamByName.set(nk, t); }',
        '                }',
        '                // Override team in allKpiInDb before building employeesMap & kpiData',
        '                for (const kpi of allKpiInDb as any[]) {',
        "                    const kpiEmail = (this.extractEmailFromKpi(kpi) || '').toLowerCase().trim();",
        "                    const kpiName = normName((kpi as any).name || '');",
        '                    const ct = (kpiEmail ? userTeamByEmail.get(kpiEmail) : null)',
        '                        || (kpiName ? userTeamByName.get(kpiName) : null);',
        '                    if (ct) (kpi as any).team = ct;',
        '                }',
        '',
    ];
    lines.splice(insertIdx, 0, ...block);
    console.log(`Inserted unified block at line ${insertIdx + 1}`);
}

writeFileSync(file, lines.join('\n'), 'utf8');
console.log(`Done. Total lines: ${lines.length}`);
