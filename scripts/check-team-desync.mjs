import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// So sánh users.team (field phái sinh) với giá trị đúng tính từ team_members
const rows = await prisma.$queryRaw`
  SELECT u.full_name, u.email, u.team AS current_team, u.is_active,
         u.lark_employee_record_id IS NOT NULL AS has_lark_link,
         u.updated_at,
         sub.expected_team
  FROM users u
  LEFT JOIN (
    SELECT tm.user_id, string_agg(t.name, ',' ORDER BY t.name) AS expected_team
    FROM team_members tm JOIN teams t ON t.id = tm.team_id
    GROUP BY tm.user_id
  ) sub ON sub.user_id = u.id
  WHERE COALESCE(u.team, '') IS DISTINCT FROM COALESCE(sub.expected_team, '')
    AND (u.team IS NOT NULL OR sub.expected_team IS NOT NULL)
  ORDER BY u.updated_at DESC`;

console.log('desynced users:', rows.length);
for (const r of rows) console.log(JSON.stringify(r));
await prisma.$disconnect();
