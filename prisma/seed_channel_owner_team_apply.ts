/**
 * Seed owner_id / team_id cho bảng huyk_channels (model Channel) — CHẠY THẬT NGAY, không cần flag.
 *
 * Match owner_id theo email (channel.email == user.email, không phân biệt hoa/thường, đã trim).
 * Match team_id theo team_traffic (channel.team_traffic == team.name, đã trim).
 * Chỉ điền vào các dòng đang NULL — không ghi đè owner_id/team_id đã có sẵn.
 *
 * Cách chạy:
 *   npx ts-node prisma/seed_channel_owner_team_apply.ts
 *
 * Yêu cầu: biến môi trường DATABASE_URL trỏ đúng database cần seed (xem file .env).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

async function main() {
  console.log('🌱 Seed owner_id/team_id cho huyk_channels\n');

  const [channels, users, teams] = await Promise.all([
    prisma.channel.findMany({
      select: { id: true, email: true, team_traffic: true, owner_id: true, team_id: true },
    }),
    prisma.user.findMany({ select: { id: true, email: true } }),
    prisma.team.findMany({ select: { id: true, name: true } }),
  ]);

  const userByEmail = new Map<string, string>();
  for (const u of users) {
    const key = normalize(u.email);
    if (key) userByEmail.set(key, u.id);
  }

  const teamByName = new Map<string, string>();
  for (const t of teams) {
    const key = normalize(t.name);
    if (key) teamByName.set(key, t.id);
  }

  const updates: { id: string; owner_id?: string; team_id?: string }[] = [];
  let ownerMatched = 0;
  let teamMatched = 0;

  for (const c of channels) {
    const data: { owner_id?: string; team_id?: string } = {};

    if (c.owner_id == null) {
      const uid = userByEmail.get(normalize(c.email));
      if (uid) {
        data.owner_id = uid;
        ownerMatched++;
      }
    }

    if (c.team_id == null) {
      const tid = teamByName.get(normalize(c.team_traffic));
      if (tid) {
        data.team_id = tid;
        teamMatched++;
      }
    }

    if (data.owner_id || data.team_id) {
      updates.push({ id: c.id, ...data });
    }
  }

  console.log(`📊 Tổng số channel: ${channels.length}`);
  console.log(`   owner_id match: ${ownerMatched}`);
  console.log(`   team_id  match: ${teamMatched}`);
  console.log(`🚀 Đang cập nhật ${updates.length} channel...\n`);

  for (const u of updates) {
    await prisma.channel.update({
      where: { id: u.id },
      data: {
        ...(u.owner_id ? { owner_id: u.owner_id } : {}),
        ...(u.team_id ? { team_id: u.team_id } : {}),
      },
    });
  }

  console.log('✅ Hoàn tất cập nhật owner_id/team_id cho huyk_channels.');
}

main()
  .catch((e) => {
    console.error('❌ Lỗi khi seed owner_id/team_id:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
