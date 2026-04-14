import { readFileSync, writeFileSync } from 'fs';

const file = 'src/modules/lark-sync/lark.service.ts';
let lines = readFileSync(file, 'utf8').split('\n');

// 1) Find the line "const targetDayKpis = kpiData.filter" and insert users.team override before it
let targetDayIdx = -1;
for (let i = 3350; i < 3400; i++) {
    if (lines[i]?.includes('const targetDayKpis = kpiData.filter')) {
        targetDayIdx = i;
        break;
    }
}
console.log(`targetDayKpis at line ${targetDayIdx + 1}`);

if (targetDayIdx >= 0) {
    const insertBlock = [
        '',
        '                // Override kpi.team with users.team (authoritative) to fix stale Lark data.',
        '                // Role from users, team from users - lark_kpi.team is often wrong/stale.',
        '                const allUsersForTeam = await this.prisma.user.findMany({',
        '                    where: { is_active: true },',
        '                    select: { email: true, full_name: true, team: true, employee_id: true }',
        '                });',
        '                const userTeamByEmail = new Map<string, string>();',
        '                const userTeamByName = new Map<string, string>();',
        '                for (const u of allUsersForTeam) {',
        "                    const t = (u.team || '').trim();",
        '                    if (!t) continue;',
        '                    if (u.email) userTeamByEmail.set(u.email.toLowerCase().trim(), t);',
        '                    if (u.full_name) { const nk = normName(u.full_name); if (nk) userTeamByName.set(nk, t); }',
        '                }',
        '                for (const kpi of kpiData) {',
        "                    const kpiEmail = this.extractEmailFromKpi(kpi)?.toLowerCase().trim() || '';",
        "                    const kpiName = normName(kpi.name || '');",
        '                    const correctTeam = (kpiEmail ? userTeamByEmail.get(kpiEmail) : null)',
        '                        || (kpiName ? userTeamByName.get(kpiName) : null);',
        '                    if (correctTeam) (kpi as any).team = correctTeam;',
        '                }',
        '',
    ];
    lines.splice(targetDayIdx, 0, ...insertBlock);
    console.log(`Inserted team override block before targetDayKpis`);
}

// 2) Also override in allKpiInDb (used to build employeesMap) - insert before "Build employee snapshot"
let empMapIdx = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.includes('Build employee snapshot from larkKPI only')) {
        empMapIdx = i;
        break;
    }
}
console.log(`employeesMap build at line ${empMapIdx + 1}`);

if (empMapIdx >= 0) {
    const insertBlock2 = [
        '                // Override allKpiInDb team with users.team (same maps as above)',
        '                for (const kpi of allKpiInDb as any[]) {',
        "                    const kpiEmail = this.extractEmailFromKpi(kpi)?.toLowerCase().trim() || '';",
        "                    const kpiName = normName(kpi.name || '');",
        '                    const correctTeam = (kpiEmail ? userTeamByEmail.get(kpiEmail) : null)',
        '                        || (kpiName ? userTeamByName.get(kpiName) : null);',
        '                    if (correctTeam) (kpi as any).team = correctTeam;',
        '                }',
        '',
    ];
    lines.splice(empMapIdx, 0, ...insertBlock2);
    console.log(`Inserted allKpiInDb team override before employeesMap build`);
}

writeFileSync(file, lines.join('\n'), 'utf8');
console.log(`Done. Total lines: ${lines.length}`);
