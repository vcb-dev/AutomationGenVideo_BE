import { readFileSync, writeFileSync } from 'fs';

const file = 'src/modules/lark-sync/lark.service.ts';
let lines = readFileSync(file, 'utf8').split('\n');

// 1) Remove allUsersForTeam block (find and remove)
let startDel = -1, endDel = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Fetch ALL users with their teams')) { startDel = i; }
    if (startDel >= 0 && lines[i].includes('userTeamByEmpId.set(')) { endDel = i + 2; break; }
}
if (startDel >= 0 && endDel > startDel) {
    lines.splice(startDel, endDel - startDel);
    console.log(`Removed allUsersForTeam block: lines ${startDel+1}-${endDel} (${endDel - startDel} lines)`);
}

// 2) Fix enrichment loop: only set role, no team override
let loopStart = -1, loopEnd = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('for (const emp of employeesMap.values())')) {
        loopStart = i;
    }
    if (loopStart >= 0 && i > loopStart && lines[i].trim() === '}' && lines[i-1]?.includes('correctTeam') || (loopStart >= 0 && i > loopStart && lines[i].trim() === '}' && lines[i+1]?.includes('const employees'))) {
        loopEnd = i;
        break;
    }
}
if (loopStart >= 0 && loopEnd > loopStart) {
    const newLoop = [
        '                for (const emp of employeesMap.values()) {',
        '                    const eKey = String(emp.email || \'\').toLowerCase().trim();',
        '                    const nKey = normName(emp.full_name);',
        '                    const fromUsers = leaderRoleByEmail.get(eKey) || leaderRoleByName.get(nKey);',
        '                    if (fromUsers) emp.role = fromUsers.role;',
        '                }',
    ];
    lines.splice(loopStart, loopEnd - loopStart + 1, ...newLoop);
    console.log(`Fixed enrichment loop: replaced lines ${loopStart+1}-${loopEnd+1}`);
}

// 3) Fix teamPool: use kpiTeams directly from lark_kpi.team
// Find "userResolvedTeams" and the whole block
let blockStart = -1, blockEnd = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Team hien thi') || lines[i].includes('users.team la nguon')) {
        blockStart = i;
    }
    if (blockStart >= 0 && lines[i].includes('// end team resolution') || (blockStart >= 0 && lines[i].includes('// #endregion') && i > blockStart + 3)) {
        blockEnd = i;
        break;
    }
}
// Also find the resolvedTeamSource and end lines
if (blockStart === -1) {
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('const userResolvedTeams = employee?.team')) {
            blockStart = i - 2; // include comment lines before
            break;
        }
    }
}

// Simpler approach: find exact lines to replace
let teamPoolLineIdx = -1;
let userResolvedIdx = -1;
let resolvedSourceEndIdx = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('const userResolvedTeams = employee?.team')) userResolvedIdx = i;
    if (lines[i].includes('const teamPool = userResolvedTeams')) teamPoolLineIdx = i;
    if (lines[i].includes('// end team resolution') || lines[i].includes('resolvedTeamSource tracked')) {
        resolvedSourceEndIdx = i;
    }
}

console.log(`userResolvedIdx=${userResolvedIdx}, teamPoolLineIdx=${teamPoolLineIdx}, resolvedSourceEndIdx=${resolvedSourceEndIdx}`);

if (userResolvedIdx >= 0 && teamPoolLineIdx >= 0) {
    // Find the comment lines before userResolvedTeams
    let commentStart = userResolvedIdx;
    for (let i = userResolvedIdx - 1; i >= userResolvedIdx - 5; i--) {
        if (lines[i].includes('Team hien thi') || lines[i].includes('Chi fallback') || lines[i].includes('users.team la nguon')) {
            commentStart = i;
        }
    }
    
    // Find end of block (after resolvedTeamSource lines)
    let endOfBlock = teamPoolLineIdx;
    for (let i = teamPoolLineIdx + 1; i < teamPoolLineIdx + 10; i++) {
        if (lines[i]?.trim() === '' && (lines[i+1]?.includes('if (employee)') || lines[i+1]?.includes('teamFixStats'))) {
            endOfBlock = i;
            break;
        }
        if (lines[i]?.includes('// #endregion') || lines[i]?.includes('// end team resolution') || lines[i]?.includes('resolvedTeamSource')) {
            endOfBlock = i;
        }
    }
    
    // Check if there are extra lines after teamPool
    for (let i = teamPoolLineIdx + 1; i <= endOfBlock + 5; i++) {
        if (lines[i]?.includes('if (employee)') || lines[i]?.includes('teamFixStats')) {
            endOfBlock = i - 1;
            // trim trailing empty lines
            while (endOfBlock > teamPoolLineIdx && lines[endOfBlock]?.trim() === '') endOfBlock--;
            while (endOfBlock > teamPoolLineIdx && (lines[endOfBlock]?.includes('// #endregion') || lines[endOfBlock]?.includes('// end team') || lines[endOfBlock]?.includes('resolvedTeamSource') || lines[endOfBlock]?.includes('stats tracked'))) endOfBlock++;
            break;
        }
    }
    
    // Just replace from commentStart to all the extra lines
    // Find the exact end by looking for the next meaningful code
    let cutEnd = teamPoolLineIdx;
    for (let i = teamPoolLineIdx + 1; i < teamPoolLineIdx + 8; i++) {
        if (lines[i]?.includes('if (employee)')) { cutEnd = i - 1; break; }
        cutEnd = i;
    }
    // Trim trailing empty/comment lines
    while (cutEnd > teamPoolLineIdx && (lines[cutEnd]?.trim() === '' || lines[cutEnd]?.includes('//') || lines[cutEnd]?.includes('stats tracked'))) cutEnd--;
    cutEnd = teamPoolLineIdx; // just replace up to teamPool line
    
    // Now replace from commentStart to after all the dead code
    // Let me just find the exact range to remove
    let removeEnd = teamPoolLineIdx;
    for (let i = teamPoolLineIdx + 1; i < teamPoolLineIdx + 10; i++) {
        if (lines[i]?.trim() === '' || lines[i]?.includes('//')) {
            removeEnd = i;
        } else {
            break;
        }
    }
    
    const newBlock = [
        '                    // Team: use lark_kpi.team directly (Lark is authoritative for team)',
        "                    const kpiTeams = String(kpi.team || report?.team || 'Kh\u00e1c')",
        "                        .split(',')",
        "                        .map((t: string) => t.trim())",
        "                        .filter(Boolean);",
        "                    const teamPool = kpiTeams;",
    ];
    
    lines.splice(commentStart, removeEnd - commentStart + 1, ...newBlock);
    console.log(`Fixed teamPool: replaced lines ${commentStart+1}-${removeEnd+1}`);
}

writeFileSync(file, lines.join('\n'), 'utf8');
console.log(`Done. Total lines: ${lines.length}`);
