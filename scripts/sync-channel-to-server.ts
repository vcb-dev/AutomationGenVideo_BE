import { Prisma, PrismaClient } from '@prisma/client';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/**
 * Mirror huyk_channels local → server. KHÔNG replace-all như trước:
 * - Kênh user tự add từ FE production (id 'manual_%') chỉ tồn tại trên server, không có ở local —
 *   deleteMany({}) cũ quét sạch chúng mỗi lần chạy ("kênh cá nhân tự biến mất").
 * - owner_id/team_id là FK trỏ vào users/teams CỦA SERVER (id local có thể lệch) và được backfill
 *   phía server — không mirror 2 cột này, chỉ backfill lại phần còn NULL sau khi sync.
 * Dòng gốc-Lark bị xóa ở local vẫn được dọn khỏi server (notIn + loại trừ manual_).
 */
async function main() {
  const localUrl = requireEnv('DATABASE_URL');
  const serverUrl = requireEnv('SERVER_DATABASE_URL');

  const local = new PrismaClient({ datasources: { db: { url: localUrl } } });
  const server = new PrismaClient({ datasources: { db: { url: serverUrl } } });

  const startedAt = Date.now();
  const channels = await local.channel.findMany();
  const CHUNK = 400;

  const localIds = channels.map((c) => c.id);
  const removed = await server.channel.deleteMany({
    where: {
      id: { notIn: localIds },
      NOT: { id: { startsWith: 'manual_' } },
    },
  });

  for (let i = 0; i < channels.length; i += CHUNK) {
    const chunk = channels.slice(i, i + CHUNK);
    if (!chunk.length) continue;
    const values = chunk.map(
      (c) => Prisma.sql`(
        ${c.id}, ${c.name}, ${c.platform}, ${c.channel_id}, ${c.link_channel},
        ${c.status}, ${c.team_traffic}, ${c.owner}, ${c.email}, ${c.created_at}, NOW()
      )`,
    );
    await server.$executeRaw(Prisma.sql`
      INSERT INTO huyk_channels
        (id, name, platform, channel_id, link_channel, status, team_traffic, owner, email, created_at, updated_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (id) DO UPDATE SET
        name         = EXCLUDED.name,
        platform     = EXCLUDED.platform,
        channel_id   = EXCLUDED.channel_id,
        link_channel = EXCLUDED.link_channel,
        status       = EXCLUDED.status,
        team_traffic = EXCLUDED.team_traffic,
        owner        = EXCLUDED.owner,
        email        = EXCLUDED.email,
        updated_at   = NOW()
    `);
  }

  // Backfill owner_id/team_id cho dòng mới (cùng logic manual_backfill_channel_owner_team.sql,
  // chỉ điền dòng đang NULL) — để cột Team/Chủ kênh trên FE hiện ngay sau sync.
  await server.$executeRaw`
    UPDATE huyk_channels c SET owner_id = u.id
    FROM users u
    WHERE lower(trim(c.email)) = lower(trim(u.email)) AND c.owner_id IS NULL
  `;
  await server.$executeRaw`
    UPDATE huyk_channels c SET team_id = t.id
    FROM teams t
    WHERE trim(c.team_traffic) = trim(t.name) AND c.team_id IS NULL
  `;

  const elapsedMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(
    `[sync-channel-to-server] done: upserted=${channels.length} removed_lark_origin=${removed.count} elapsed_ms=${elapsedMs}`,
  );

  await Promise.allSettled([local.$disconnect(), server.$disconnect()]);
}

main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error('[sync-channel-to-server] failed:', e?.message || e);
  process.exitCode = 1;
});
