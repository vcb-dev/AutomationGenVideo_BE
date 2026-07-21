import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

function normalizeName(val?: string | null): string {
  return (val || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .trim()
    .replace(/\s+/g, ' ');
}

async function main() {
  const prisma = new PrismaClient();

  const users = await prisma.user.findMany({
    where: {
      team: { contains: 'ADS' },
    },
    select: { email: true, full_name: true, team: true, is_active: true, employee_status: true },
  });
  const usersK4 = await prisma.user.findMany({
    where: { team: { contains: 'K4' } },
    select: { email: true, full_name: true, team: true, is_active: true, employee_status: true },
  });
  const allUsers = [...users, ...usersK4];
  console.log(`Team ADS members: ${users.length}, Team K4 members: ${usersK4.length}`);

  // Bucket for today's business date (2026-07-20, target for reportDate=2026-07-21)
  const start = new Date('2026-07-19T17:00:00.000Z');
  const end = new Date('2026-07-20T16:59:59.999Z');
  const reports = await prisma.checklistReport.findMany({
    where: { date: { gte: start, lte: end } },
    select: { id: true, name: true, email: true, team: true, created_at: true },
  });
  console.log(`Reports in bucket: ${reports.length}`);

  console.log('\n--- Team ADS / K4 members and their match status ---');
  for (const u of allUsers) {
    const uEmailNorm = (u.email || '').trim().toLowerCase();
    const uNameNorm = normalizeName(u.full_name);
    const byEmail = reports.find(r => (r.email || '').trim().toLowerCase() === uEmailNorm);
    const byName = reports.filter(r => normalizeName(r.name) === uNameNorm);
    console.log(`${u.full_name} <${u.email}> team="${u.team}" active=${u.is_active} status=${u.employee_status}`);
    if (byEmail) {
      console.log(`   -> MATCHED BY EMAIL: report.name="${byEmail.name}" report.email="${byEmail.email}" report.team="${byEmail.team}" created=${byEmail.created_at.toISOString()}`);
    } else if (byName.length > 0) {
      byName.forEach(r => console.log(`   -> MATCHED BY NAME ONLY (no email on report row): report.name="${r.name}" report.email="${r.email || '(none)'}" created=${r.created_at.toISOString()}`));
    } else {
      console.log('   -> no match (should be able to submit)');
    }
  }

  // Check for name collisions within these teams
  console.log('\n--- Duplicate full_name within ADS/K4 (potential name-fallback collision) ---');
  const nameMap = new Map<string, string[]>();
  allUsers.forEach(u => {
    const key = normalizeName(u.full_name);
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key)!.push(u.email || '(no email)');
  });
  for (const [name, emails] of nameMap) {
    if (emails.length > 1) console.log(`DUPLICATE NAME "${name}": ${emails.join(', ')}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error('ERROR', e); process.exit(1); });
