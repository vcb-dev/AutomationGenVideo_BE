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
  const kpis = await local.kpiDoDa.findMany();
  console.log(`[sync-larkkpi-doda-to-server] Loaded ${kpis.length} local records.`);

  // Clear remote kpi_do_da table first using ultra-fast raw SQL
  console.log('[sync-larkkpi-doda-to-server] Cleaning remote kpi_do_da table...');
  await server.$executeRawUnsafe('DELETE FROM "kpi_do_da"');

  let upserted = 0;
  const CHUNK_SIZE = 100;
  for (let i = 0; i < kpis.length; i += CHUNK_SIZE) {
    const chunk = kpis.slice(i, i + CHUNK_SIZE);
    await server.kpiDoDa.createMany({
      data: chunk as any,
      skipDuplicates: true
    });
    upserted += chunk.length;
    console.log(`[sync-larkkpi-doda-to-server] inserted chunk ${Math.floor(i / CHUNK_SIZE) + 1} (${chunk.length} rows)`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  const elapsedMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(
    `[sync-larkkpi-doda-to-server] done: upserted=${upserted} total_local=${kpis.length} elapsed_ms=${elapsedMs}`,
  );

  await Promise.allSettled([local.$disconnect(), server.$disconnect()]);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[sync-larkkpi-doda-to-server] failed:', e?.message || e);
  process.exitCode = 1;
});
