import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Prisma client gốc HOẶC transaction client — mọi helper trong file nhận cả hai
 * để có thể chạy bên trong $transaction (các luồng gán/thay team gồm nhiều bước
 * ghi, lỗi giữa chừng không được để lại trạng thái dở dang).
 */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * Timeout mặc định của Prisma interactive transaction là 5s — quá ngắn cho DB ở xa (Supabase
 * Tokyo, RTT ~300-900ms/query từ máy dev) khi transaction gồm nhiều bước tuần tự (upsert team,
 * sync membership, seed KPI, resync field phái sinh). maxWait là thời gian chờ để GIÀNH được 1
 * transaction slot từ pool (PgBouncer pool nhỏ), timeout là thời gian transaction được phép chạy.
 */
export const TEAM_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

/** Mở transaction nếu nhận client gốc; nếu đã ở trong transaction thì chạy thẳng. */
async function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  if ('$transaction' in db) {
    return (db as PrismaService).$transaction((tx) => fn(tx), TEAM_TX_OPTIONS);
  }
  return fn(db);
}

/**
 * Tách chuỗi "TeamA, TeamB" (multi-select FE join bằng dấu phẩy) thành mảng tên team.
 * Dấu phẩy là ký tự phân cách nên tên team KHÔNG được chứa dấu phẩy — đã chặn ở
 * CreateTeamDto và isValidNewOption phía FE.
 */
function parseTeamNames(teamNamesRaw: string | null | undefined): string[] {
  return (teamNamesRaw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Tính lại User.team (join tên các Team, phân cách dấu phẩy) từ TeamMember hiện tại — cho MỘT
 * LOẠT user trong 1 câu UPDATE duy nhất, thay vì 1 SELECT + 1 UPDATE cho từng user. Team càng
 * đông thành viên (resyncTeamMembers) hoặc thao tác càng ảnh hưởng nhiều user thì vòng lặp cũ
 * càng cộng dồn round-trip tới DB — với DB ở xa (Supabase Tokyo) một team 10 người từng đủ để
 * vượt timeout transaction 5s mặc định của Prisma và làm cả request 500. LEFT JOIN đảm bảo user
 * không còn TeamMember nào vẫn có mặt trong kết quả (team_names = NULL từ string_agg toàn NULL).
 */
export async function recomputeUserTeamFieldsBatch(db: Db, userIds: string[]): Promise<void> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  // users.id / teams.id / team_members.team_id-user_id đều là cột `text` thật sự trong DB (giá trị
  // trông như UUID nhưng KHÔNG phải kiểu native `uuid` của Postgres — lệch với @db.Uuid trong
  // schema.prisma). Cast `::uuid[]` khiến Postgres báo lỗi "operator does not exist: text = uuid"
  // và làm ROLLBACK toàn bộ transaction gọi hàm này (assignUserToTeams/replaceUserTeamsByName/
  // addMember...) — mọi thao tác gán/đổi team qua các hàm đó đều thất bại ở bước cuối này.
  await db.$executeRaw`
    UPDATE users u
    SET team = sub.team_names
    FROM (
      SELECT uid, string_agg(name, ',' ORDER BY name) AS team_names
      FROM (
        SELECT u2.id AS uid, t.name
        FROM users u2
        LEFT JOIN team_members tm ON tm.user_id = u2.id
        LEFT JOIN teams t ON t.id = tm.team_id
        WHERE u2.id = ANY(${ids}::text[])
      ) x
      GROUP BY uid
    ) sub
    WHERE u.id = sub.uid
  `;
}

/** Tính lại User.team (phái sinh) cho một user — xem recomputeUserTeamFieldsBatch. */
export async function recomputeUserTeamFields(db: Db, userId: string): Promise<void> {
  await recomputeUserTeamFieldsBatch(db, [userId]);
}

/** Recompute field phái sinh cho nhiều user (bỏ trùng) trong 1 UPDATE duy nhất. */
async function recomputeUsers(db: Db, userIds: Iterable<string>): Promise<void> {
  await recomputeUserTeamFieldsBatch(db, [...new Set(userIds)]);
}

/**
 * Khi Team.leader_id đổi (thay leader / thu hồi leader), field phái sinh
 * User.team của TOÀN BỘ member trong team đó cần được resync hết.
 */
async function resyncTeamMembers(db: Db, teamIds: string[]): Promise<void> {
  if (!teamIds.length) return;
  const memberships = await db.teamMember.findMany({
    where: { team_id: { in: teamIds } },
    select: { user_id: true },
  });
  await recomputeUserTeamFieldsBatch(db, memberships.map((m) => m.user_id));
}

/** Id các Team mà user đang là TeamMember HOẶC là leader_id (dùng để nhân bản "team của tôi" khi leader tạo/claim member). */
export async function getUserTeamIds(db: Db, userId: string): Promise<string[]> {
  const [memberships, ledTeams] = await Promise.all([
    db.teamMember.findMany({ where: { user_id: userId }, select: { team_id: true } }),
    db.team.findMany({ where: { leader_id: userId }, select: { id: true } }),
  ]);
  return [...new Set([...memberships.map((m) => m.team_id), ...ledTeams.map((t) => t.id)])];
}

/**
 * Tạo sẵn EditorKpi (chỉ tiêu 0) tháng hiện tại cho các user-team CHƯA có dòng KPI —
 * chỉ áp dụng cho user có role MEMBER (editor tiềm năng); tạo KPI cho ADMIN/MANAGER/
 * LEADER chỉ làm bẩn bảng KPI vì họ không nhận task auto-assign.
 * skipDuplicates dựa trên unique(user_id, team_id, month) nên không đè KPI thật đã set.
 */
export async function seedEditorKpiForMembers(
  db: Db,
  userIds: string[],
  teamIds: string[],
  setById: string,
): Promise<void> {
  if (!userIds.length || !teamIds.length) return;
  const memberUsers = await db.user.findMany({
    where: { id: { in: userIds }, roles: { has: 'MEMBER' } },
    select: { id: true },
  });
  if (!memberUsers.length) return;
  const month = DateTime.now().toFormat('yyyy-MM');
  await db.editorKpi.createMany({
    data: memberUsers.flatMap((u) =>
      teamIds.map((team_id) => ({ user_id: u.id, team_id, month, total_target: 0, set_by_id: setById })),
    ),
    skipDuplicates: true,
  });
}

/**
 * Gán user vào các Team (theo id) nếu chưa là member, seed KPI nếu là MEMBER,
 * rồi tính lại team phái sinh. Chạy trong transaction.
 */
export async function assignUserToTeams(
  db: Db,
  userId: string,
  teamIds: string[],
  setById: string,
): Promise<void> {
  await inTransaction(db, async (tx) => {
    if (teamIds.length) {
      await tx.teamMember.createMany({
        data: teamIds.map((team_id) => ({ team_id, user_id: userId })),
        skipDuplicates: true,
      });
      await seedEditorKpiForMembers(tx, [userId], teamIds, setById);
    }
    await recomputeUserTeamFields(tx, userId);
  });
}

interface ResolvedTeams {
  teamIds: string[];
  /** Leader cũ của các team vừa bị user này thay — cần recompute field phái sinh của họ. */
  displacedLeaderIds: string[];
  /** Các team có leader_id vừa đổi — member của chúng cần resync field team phái sinh. */
  leaderChangedTeamIds: string[];
}

/**
 * Đổi tên team → id. Với LEADER: team chưa có thì tạo mới, team đã có thì user này
 * trở thành leader (thay leader cũ — quyết định của ADMIN/MANAGER, nhưng leader cũ
 * và member của team phải được resync, xem ResolvedTeams). Với role khác: chỉ nhận
 * team ĐÃ tồn tại — tên lạ bị từ chối rõ ràng thay vì bỏ qua âm thầm (tránh việc
 * User.team hiển thị một team không hề có trong Team/TeamMember).
 */
async function resolveTeamsByName(
  tx: Db,
  teamNames: string[],
  userId: string,
  roles: string[],
): Promise<ResolvedTeams> {
  const existing = await tx.team.findMany({
    where: { name: { in: teamNames } },
    select: { id: true, name: true, leader_id: true },
  });

  if (!roles.includes('LEADER')) {
    const foundNames = new Set(existing.map((t) => t.name));
    const missing = teamNames.filter((n) => !foundNames.has(n));
    if (missing.length) {
      throw new BadRequestException(
        `Đội nhóm không tồn tại: ${missing.join(', ')}. Chỉ Leader mới được tạo team mới.`,
      );
    }
    // User vừa bị đổi khỏi role LEADER (vd demote về MEMBER) nhưng team chọn không đổi —
    // nếu họ vẫn đang là leader_id của (các) team này thì phải thu hồi ở đây, vì vòng thu
    // hồi ở replaceUserTeamsByName chỉ xét team bị BỎ CHỌN (id notIn teamIds), không xét
    // trường hợp mất quyền LEADER mà team vẫn còn trong danh sách chọn. Không thu hồi thì
    // teams.leader_id trỏ vào một user không còn role LEADER — mọi kiểm tra quyền dựa trên
    // Team.leader_id (isTeamLeaderOfUser, getTeamMembers) sẽ dựa trên dữ liệu sai.
    const ownLedTeams = existing.filter((t) => t.leader_id === userId);
    const leaderChangedTeamIds: string[] = [];
    if (ownLedTeams.length) {
      await tx.team.updateMany({
        where: { id: { in: ownLedTeams.map((t) => t.id) } },
        data: { leader_id: null },
      });
      leaderChangedTeamIds.push(...ownLedTeams.map((t) => t.id));
    }
    return { teamIds: existing.map((t) => t.id), displacedLeaderIds: [], leaderChangedTeamIds };
  }

  const byName = new Map(existing.map((t) => [t.name, t]));
  const teamIds: string[] = [];
  const displacedLeaderIds: string[] = [];
  const leaderChangedTeamIds: string[] = [];
  for (const name of teamNames) {
    const current = byName.get(name);
    if (current && current.leader_id !== userId) {
      if (current.leader_id) displacedLeaderIds.push(current.leader_id);
      leaderChangedTeamIds.push(current.id);
    }
    const team = await tx.team.upsert({
      where: { name },
      create: { name, leader_id: userId, is_active: true },
      update: { leader_id: userId },
    });
    teamIds.push(team.id);
  }
  return { teamIds, displacedLeaderIds, leaderChangedTeamIds };
}

/**
 * Dùng khi ADMIN/MANAGER TẠO MỚI user và chọn/gõ (các) tên team qua multi-select.
 * Chỉ THÊM membership (user mới không có gì để gỡ). Toàn bộ chạy trong 1 transaction.
 */
export async function assignUserToTeamsByName(
  db: Db,
  userId: string,
  teamNamesRaw: string | null | undefined,
  roles: string[],
  setById: string,
): Promise<void> {
  const teamNames = parseTeamNames(teamNamesRaw);
  await inTransaction(db, async (tx) => {
    if (!teamNames.length) {
      await recomputeUserTeamFields(tx, userId);
      return;
    }
    const { teamIds, displacedLeaderIds, leaderChangedTeamIds } = await resolveTeamsByName(tx, teamNames, userId, roles);
    await tx.teamMember.createMany({
      data: teamIds.map((team_id) => ({ team_id, user_id: userId })),
      skipDuplicates: true,
    });
    await seedEditorKpiForMembers(tx, [userId], teamIds, setById);
    await recomputeUserTeamFields(tx, userId);
    await recomputeUsers(tx, displacedLeaderIds);
    await resyncTeamMembers(tx, leaderChangedTeamIds);
  });
}

/**
 * Dùng khi ADMIN/MANAGER SỬA (các) team của user qua multi-select — danh sách mới là
 * TOÀN BỘ sự thật: team bị bỏ chọn thì user rời membership, và nếu user đang là
 * leader_id của team đó thì quyền leader cũng bị THU HỒI (leader_id = null) — mọi
 * kiểm tra phân quyền đều dựa trên Team.leader_id nên không thu hồi là lỗ hổng thật.
 * Toàn bộ chạy trong 1 transaction; mọi user bị ảnh hưởng đều được resync.
 */
export async function replaceUserTeamsByName(
  db: Db,
  userId: string,
  teamNamesRaw: string | null | undefined,
  roles: string[],
  setById: string,
): Promise<void> {
  const teamNames = parseTeamNames(teamNamesRaw);
  await inTransaction(db, async (tx) => {
    const { teamIds, displacedLeaderIds, leaderChangedTeamIds } = teamNames.length
      ? await resolveTeamsByName(tx, teamNames, userId, roles)
      : { teamIds: [] as string[], displacedLeaderIds: [] as string[], leaderChangedTeamIds: [] as string[] };

    // Thu hồi quyền leader ở các team không còn trong danh sách.
    const revokedTeams = await tx.team.findMany({
      where: { leader_id: userId, id: { notIn: teamIds } },
      select: { id: true },
    });
    if (revokedTeams.length) {
      await tx.team.updateMany({
        where: { id: { in: revokedTeams.map((t) => t.id) } },
        data: { leader_id: null },
      });
    }

    await tx.teamMember.deleteMany({ where: { user_id: userId, team_id: { notIn: teamIds } } });
    if (teamIds.length) {
      await tx.teamMember.createMany({
        data: teamIds.map((team_id) => ({ team_id, user_id: userId })),
        skipDuplicates: true,
      });
      await seedEditorKpiForMembers(tx, [userId], teamIds, setById);
    }

    await recomputeUserTeamFields(tx, userId);
    await recomputeUsers(tx, displacedLeaderIds);
    await resyncTeamMembers(tx, [...leaderChangedTeamIds, ...revokedTeams.map((t) => t.id)]);
  });
}

/** Xoá toàn bộ TeamMember của user (giải phóng về pool chung), thu hồi quyền leader nếu có, rồi tính lại field phái sinh. */
export async function clearUserTeams(db: Db, userId: string): Promise<void> {
  await replaceUserTeamsByName(db, userId, null, [], userId);
}

/** true nếu user không thuộc Team nào (dùng để xác định "unclaimed", thay cho check team === null cũ). */
export async function isUserUnassigned(db: Db, userId: string): Promise<boolean> {
  const count = await db.teamMember.count({ where: { user_id: userId } });
  return count === 0;
}

/** true nếu leaderId là leader_id của Team mà targetUserId đang là member (thay cho check team_leader_id === callerId cũ). */
export async function isTeamLeaderOfUser(db: Db, leaderId: string, targetUserId: string): Promise<boolean> {
  const membership = await db.teamMember.findFirst({
    where: { user_id: targetUserId, team: { leader_id: leaderId } },
    select: { id: true },
  });
  return !!membership;
}
