import { PrismaClient } from '@prisma/client';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** Copy toàn bộ huyk_channels từ local → server bằng replace-all (giống mirror KPI), tránh dòng server thừa. */
async function main() {
  const localUrl = requireEnv('DATABASE_URL');
  const serverUrl = requireEnv('SERVER_DATABASE_URL');

  const local = new PrismaClient({ datasources: { db: { url: localUrl } } });
  const server = new PrismaClient({ datasources: { db: { url: serverUrl } } });

  const startedAt = Date.now();
  const channels = await local.channel.findMany();
  const CHUNK = 400;

  await server.channel.deleteMany({});
  for (let i = 0; i < channels.length; i += CHUNK) {
    const chunk = channels.slice(i, i + CHUNK);
    if (chunk.length) {
      await server.channel.createMany({ data: chunk as any, skipDuplicates: true });
    }
  }

  const elapsedMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(
    `[sync-channel-to-server] done: rows=${channels.length} replace-all on server elapsed_ms=${elapsedMs}`,
  );

  await Promise.allSettled([local.$disconnect(), server.$disconnect()]);
}

main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error('[sync-channel-to-server] failed:', e?.message || e);
  process.exitCode = 1;
});
