import { PrismaClient } from '@prisma/client';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function main() {
  const localUrl = requireEnv('DATABASE_URL');
  const serverUrl = requireEnv('SERVER_DATABASE_URL');

  const local = new PrismaClient({ datasources: { db: { url: localUrl } } });
  const server = new PrismaClient({ datasources: { db: { url: serverUrl } } });

  const startedAt = Date.now();
  const users = await local.user.findMany();

  let upserted = 0;
  for (const u of users) {
    if (!u.email) continue;
    
    // Proactively handle unique constraint conflicts on server
    if (u.employee_id) {
       await server.user.updateMany({
         where: { employee_id: u.employee_id, email: { not: u.email } },
         data: { employee_id: null }
       });
    }
    if (u.lark_employee_record_id) {
       await server.user.updateMany({
         where: { lark_employee_record_id: u.lark_employee_record_id, email: { not: u.email } },
         data: { lark_employee_record_id: null }
       });
    }

    await server.user.upsert({
      where: { email: u.email },
      update: {
        password_hash: u.password_hash,
        full_name: u.full_name,
        google_id: u.google_id,
        manager_id: u.manager_id,
        is_active: u.is_active,
        lark_permissions: u.lark_permissions as any,
        last_app_update_at: u.last_app_update_at,
        roles: u.roles as any,
        team: u.team,
        team_leader_id: u.team_leader_id,
        lark_employee_record_id: u.lark_employee_record_id,
        employee_id: u.employee_id,
        image_url: u.image_url,
        employee_data: u.employee_data as any,
        employee_position: u.employee_position,
        employee_status: u.employee_status,
        employee_date: u.employee_date,
      },
      create: {
        id: u.id,
        email: u.email,
        password_hash: u.password_hash,
        full_name: u.full_name,
        google_id: u.google_id,
        manager_id: u.manager_id,
        is_active: u.is_active,
        lark_permissions: u.lark_permissions as any,
        last_app_update_at: u.last_app_update_at,
        roles: u.roles as any,
        team: u.team,
        team_leader_id: u.team_leader_id,
        lark_employee_record_id: u.lark_employee_record_id,
        employee_id: u.employee_id,
        image_url: u.image_url,
        employee_data: u.employee_data as any,
        employee_position: u.employee_position,
        employee_status: u.employee_status,
        employee_date: u.employee_date,
      },
    });

    upserted++;
    if (upserted % 200 === 0) {
      // eslint-disable-next-line no-console
      console.log(`[sync-users-to-server] upserted ${upserted}/${users.length}`);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(
    `[sync-users-to-server] done: upserted=${upserted} total_local=${users.length} elapsed_ms=${elapsedMs}`,
  );

  await Promise.allSettled([local.$disconnect(), server.$disconnect()]);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[sync-users-to-server] failed:', e?.message || e);
  process.exitCode = 1;
});
