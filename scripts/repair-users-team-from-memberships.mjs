// REPAIR: tính lại users.team (field phái sinh) từ team_members/teams — nguồn sự thật.
// Chỉ sửa các user ĐANG CÓ membership (expected_team NOT NULL) để tránh null-hoá
// những user có team gán tay từ trước nhưng không có membership (cần review riêng).
// Chạy: node scripts/repair-users-team-from-memberships.mjs [--dry-run]
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

const desynced = await prisma.$queryRaw`
  SELECT u.id, u.full_name, u.team AS current_team, sub.expected_team
  FROM users u
  JOIN (
    SELECT tm.user_id, string_agg(t.name, ',' ORDER BY t.name) AS expected_team
    FROM team_members tm JOIN teams t ON t.id = tm.team_id
    GROUP BY tm.user_id
  ) sub ON sub.user_id = u.id
  WHERE COALESCE(u.team, '') IS DISTINCT FROM sub.expected_team`;

console.log(`${dryRun ? '[DRY-RUN] ' : ''}users to repair: ${desynced.length}`);
for (const r of desynced) {
  console.log(`- ${r.full_name}: "${r.current_team}" -> "${r.expected_team}"`);
}

if (!dryRun && desynced.length) {
  const n = await prisma.$executeRaw`
    UPDATE users u
    SET team = sub.expected_team
    FROM (
      SELECT tm.user_id, string_agg(t.name, ',' ORDER BY t.name) AS expected_team
      FROM team_members tm JOIN teams t ON t.id = tm.team_id
      GROUP BY tm.user_id
    ) sub
    WHERE u.id = sub.user_id
      AND COALESCE(u.team, '') IS DISTINCT FROM sub.expected_team`;
  console.log(`updated rows: ${n}`);
}
await prisma.$disconnect();
