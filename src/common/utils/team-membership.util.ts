import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Tính lại User.team (join tên các Team, phân cách dấu phẩy) và User.team_leader_id
 * (leader_id của một trong các Team) từ TeamMember hiện tại của user — giữ 2 cột phẳng
 * này luôn khớp với Team/TeamMember (nguồn sự thật) để API cũ không cần đổi hình dạng.
 */
export async function recomputeUserTeamFields(prisma: PrismaService, userId: string): Promise<void> {
  const memberships = await prisma.teamMember.findMany({
    where: { user_id: userId },
    include: { team: { select: { name: true, leader_id: true } } },
    orderBy: { team: { name: 'asc' } },
  });
  const teamNames = memberships.map((m) => m.team.name);
  const teamString = teamNames.length ? teamNames.join(',') : null;
  const leaderId = memberships.find((m) => m.team.leader_id)?.team.leader_id ?? null;
  await prisma.user.update({ where: { id: userId }, data: { team: teamString, team_leader_id: leaderId } });
}

/** Id các Team mà user đang là TeamMember HOẶC là leader_id (dùng để nhân bản "team của tôi" khi leader tạo/claim member). */
export async function getUserTeamIds(prisma: PrismaService, userId: string): Promise<string[]> {
  const [memberships, ledTeams] = await Promise.all([
    prisma.teamMember.findMany({ where: { user_id: userId }, select: { team_id: true } }),
    prisma.team.findMany({ where: { leader_id: userId }, select: { id: true } }),
  ]);
  return [...new Set([...memberships.map((m) => m.team_id), ...ledTeams.map((t) => t.id)])];
}

/**
 * Đảm bảo user có dòng EditorKpi cho team + tháng hiện tại (chỉ tiêu mặc định 0) — nếu
 * chưa có, tạo mới; nếu đã có (dù ai set) thì giữ nguyên, không ghi đè số thật.
 * set_by_id bắt buộc phải là 1 User thật nên dùng chính người thực hiện thao tác gán team.
 */
async function ensureEditorKpiForCurrentMonth(
  prisma: PrismaService,
  userId: string,
  teamId: string,
  setById: string,
): Promise<void> {
  const month = DateTime.now().toFormat('yyyy-MM');
  const existing = await prisma.editorKpi.findUnique({
    where: { user_id_team_id_month: { user_id: userId, team_id: teamId, month } },
  });
  if (existing) return;
  await prisma.editorKpi.create({
    data: { user_id: userId, team_id: teamId, month, total_target: 0, set_by_id: setById },
  });
}

/**
 * Gán user vào các Team (theo id) nếu chưa là member, rồi tính lại team/team_leader_id phái sinh.
 * Đồng thời tạo sẵn EditorKpi=0 cho tháng hiện tại ở mỗi team mới — để user "hiện diện" trong
 * team ngay (không bị auto-assign bỏ qua vì thiếu KPI), quản lý chỉ cần sửa lại số thật sau.
 */
export async function assignUserToTeams(
  prisma: PrismaService,
  userId: string,
  teamIds: string[],
  setById: string,
): Promise<void> {
  for (const teamId of teamIds) {
    const existing = await prisma.teamMember.findFirst({ where: { team_id: teamId, user_id: userId } });
    if (!existing) {
      await prisma.teamMember.create({ data: { team_id: teamId, user_id: userId } });
    }
    await ensureEditorKpiForCurrentMonth(prisma, userId, teamId, setById);
  }
  await recomputeUserTeamFields(prisma, userId);
}

/** Xoá toàn bộ TeamMember của user (giải phóng về pool chung), rồi tính lại team/team_leader_id (sẽ thành null). */
export async function clearUserTeams(prisma: PrismaService, userId: string): Promise<void> {
  await prisma.teamMember.deleteMany({ where: { user_id: userId } });
  await recomputeUserTeamFields(prisma, userId);
}

/** true nếu user không thuộc Team nào (dùng để xác định "unclaimed", thay cho check team === null cũ). */
export async function isUserUnassigned(prisma: PrismaService, userId: string): Promise<boolean> {
  const count = await prisma.teamMember.count({ where: { user_id: userId } });
  return count === 0;
}

/** true nếu leaderId là leader_id của Team mà targetUserId đang là member (thay cho check team_leader_id === callerId cũ). */
export async function isTeamLeaderOfUser(prisma: PrismaService, leaderId: string, targetUserId: string): Promise<boolean> {
  const membership = await prisma.teamMember.findFirst({
    where: { user_id: targetUserId, team: { leader_id: leaderId } },
    select: { id: true },
  });
  return !!membership;
}
