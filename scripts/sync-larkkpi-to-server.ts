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
  const kpis = await local.larkKPI.findMany();

  let upserted = 0;
  for (const k of kpis) {
    await server.larkKPI.upsert({
      where: { id: k.id },
      update: {
        employee_id: k.employee_id,
        name: k.name,
        tag: k.tag,
        team: k.team,
        image_url: k.image_url,
        kpi_day: k.kpi_day,
        kpi_month: k.kpi_month,
        kpii_status: k.kpii_status,
        kpi_day_percent: k.kpi_day_percent,
        completed_day: k.completed_day,
        completed_month: k.completed_month,
        task_new: k.task_new,
        task_new_month: k.task_new_month,
        task_auto: k.task_auto,
        task_auto_month: k.task_auto_month,
        task_creative: k.task_creative,
        content_win_new: k.content_win_new,
        revenue_month: k.revenue_month,
        traffic_month: k.traffic_month,
        target_revenue_month: k.target_revenue_month,
        target_traffic_month: k.target_traffic_month,
        kpi_progress_month: k.kpi_progress_month,
        employee_status: k.employee_status,
        state: k.state,
        employee_data: k.employee_data,
        report_date: k.report_date,
        month: k.month,
        link_image: k.link_image,
      },
      create: {
        id: k.id,
        employee_id: k.employee_id,
        name: k.name,
        tag: k.tag,
        team: k.team,
        image_url: k.image_url,
        kpi_day: k.kpi_day,
        kpi_month: k.kpi_month,
        kpii_status: k.kpii_status,
        kpi_day_percent: k.kpi_day_percent,
        completed_day: k.completed_day,
        completed_month: k.completed_month,
        task_new: k.task_new,
        task_new_month: k.task_new_month,
        task_auto: k.task_auto,
        task_auto_month: k.task_auto_month,
        task_creative: k.task_creative,
        content_win_new: k.content_win_new,
        revenue_month: k.revenue_month,
        traffic_month: k.traffic_month,
        target_revenue_month: k.target_revenue_month,
        target_traffic_month: k.target_traffic_month,
        kpi_progress_month: k.kpi_progress_month,
        employee_status: k.employee_status,
        state: k.state,
        employee_data: k.employee_data,
        report_date: k.report_date,
        month: k.month,
        link_image: k.link_image,
      },
    });
    upserted++;
    if (upserted % 500 === 0) {
      // eslint-disable-next-line no-console
      console.log(`[sync-larkkpi-to-server] upserted ${upserted}/${kpis.length}`);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(
    `[sync-larkkpi-to-server] done: upserted=${upserted} total_local=${kpis.length} elapsed_ms=${elapsedMs}`,
  );

  await Promise.allSettled([local.$disconnect(), server.$disconnect()]);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[sync-larkkpi-to-server] failed:', e?.message || e);
  process.exitCode = 1;
});

