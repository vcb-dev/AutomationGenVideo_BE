/// <reference types="node" />
import { PrismaClient } from '@prisma/client';
import * as process from 'node:process';

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
  const CHUNK = 500;
  await server.larkKPI.deleteMany({});
  let inserted = 0;
  for (let i = 0; i < kpis.length; i += CHUNK) {
    const chunk = kpis.slice(i, i + CHUNK);
    if (!chunk.length) continue;
    await server.larkKPI.createMany({ data: chunk as any, skipDuplicates: true });
    inserted += chunk.length;
    // eslint-disable-next-line no-console
    console.log(`[sync-larkkpi-to-server] inserted ${inserted}/${kpis.length}`);
  }

  const elapsedMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(
    `[sync-larkkpi-to-server] done: replace-all rows=${kpis.length} elapsed_ms=${elapsedMs}`,
  );

  await Promise.allSettled([local.$disconnect(), server.$disconnect()]);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[sync-larkkpi-to-server] failed:', e?.message || e);
  process.exit(1);
});

