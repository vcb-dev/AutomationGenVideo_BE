import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SocialPostStatus, UserRole } from '@prisma/client';

export interface HistoryFilter {
  team?: string;
  employeeId?: string;
}

const ADMIN_ROLES  = ['ADMIN', 'MANAGER'];
const LEADER_ROLES = ['LEADER'];

function isAdmin(roles: string[]): boolean {
  return roles.some(r => ADMIN_ROLES.includes(r));
}

function isLeader(roles: string[]): boolean {
  return !isAdmin(roles) && roles.some(r => LEADER_ROLES.includes(r));
}

function isPrivileged(roles: string[]): boolean {
  return isAdmin(roles) || isLeader(roles);
}

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lấy team của người gọi (dùng cho LEADER).
   */
  private async getCallerTeam(callerId: string): Promise<string | null> {
    const caller = await this.prisma.user.findUnique({
      where: { id: callerId },
      select: { team: true },
    });
    return caller?.team ?? null;
  }

  /**
   * Resolve danh sách user_id cần filter theo role:
   * - MEMBER/EDITOR/CONTENT → chỉ chính họ
   * - ADMIN/MANAGER + employeeId → chỉ nhân viên đó
   * - ADMIN/MANAGER + team       → tất cả user trong team
   * - ADMIN/MANAGER (không filter) → tất cả (undefined)
   * - LEADER + employeeId → chỉ nhân viên đó (trong team mình)
   * - LEADER + team       → team đó (chỉ nếu là team mình, không thì team mình)
   * - LEADER (không filter) → tất cả user trong team mình
   */
  private async resolveUserIds(
    callerId: string,
    callerRoles: string[],
    filter: HistoryFilter,
  ): Promise<{ in: string[] } | undefined> {
    if (!isPrivileged(callerRoles)) {
      return { in: [callerId] };
    }

    // LEADER: mặc định giới hạn trong team mình
    if (isLeader(callerRoles)) {
      const leaderTeam = await this.getCallerTeam(callerId);

      // Filter theo employeeId — chỉ cho phép nếu nhân viên đó thuộc team của LEADER
      if (filter.employeeId) {
        const employee = await this.prisma.user.findUnique({
          where: { id: filter.employeeId },
          select: { team: true },
        });
        if (!employee || employee.team !== leaderTeam) {
          throw new ForbiddenException('Không có quyền xem lịch sử của nhân viên ngoài team');
        }
        return { in: [filter.employeeId] };
      }

      // Filter theo team — LEADER chỉ thấy team mình, bỏ qua filter.team từ client
      const teamToFilter = leaderTeam;
      if (!teamToFilter) return { in: [callerId] }; // leader không có team → chỉ thấy bản thân

      const users = await this.prisma.user.findMany({
        where: { team: teamToFilter, is_active: true },
        select: { id: true },
      });
      return { in: users.map(u => u.id) };
    }

    // ADMIN / MANAGER
    if (filter.employeeId) {
      return { in: [filter.employeeId] };
    }

    if (filter.team) {
      const users = await this.prisma.user.findMany({
        where: { team: filter.team, is_active: true },
        select: { id: true },
      });
      return { in: users.map(u => u.id) };
    }

    return undefined; // admin không filter → thấy tất cả
  }

  async findAll(userId: string, callerRoles: string[], filter: HistoryFilter = {}, limit = 50) {
    const userIdFilter = await this.resolveUserIds(userId, callerRoles, filter);
    return this.prisma.socialPost.findMany({
      where: { ...(userIdFilter ? { user_id: userIdFilter } : {}) },
      orderBy: [{ executed_at: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
      take: limit,
      include: {
        account: { select: { name: true, username: true, avatar_url: true, platform: true } },
        user:    { select: { id: true, full_name: true, team: true, image_url: true } },
      },
    });
  }

  async getStats(userId: string, callerRoles: string[], filter: HistoryFilter = {}) {
    const userIdFilter = await this.resolveUserIds(userId, callerRoles, filter);
    const where = userIdFilter ? { user_id: userIdFilter } : {};

    const [statusCounts, platformCounts] = await Promise.all([
      this.prisma.socialPost.groupBy({
        by: ['status'],
        where,
        _count: { status: true },
      }),
      this.prisma.socialPost.groupBy({
        by: ['platform'],
        where,
        _count: { platform: true },
      }),
    ]);

    const byStatus = Object.fromEntries(statusCounts.map((r) => [r.status, r._count.status]));
    const byPlatform = Object.fromEntries(platformCounts.map((r) => [r.platform, r._count.platform]));
    const total = statusCounts.reduce((sum, r) => sum + r._count.status, 0);

    return {
      total,
      success: byStatus['COMPLETED'] || 0,
      failed: byStatus['FAILED'] || 0,
      pending: byStatus['PENDING'] || 0,
      byPlatform,
    };
  }

  async getNotifications(userId: string, callerRoles: string[], filter: HistoryFilter = {}) {
    const userIdFilter = await this.resolveUserIds(userId, callerRoles, filter);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.prisma.socialPost.findMany({
      where: {
        ...(userIdFilter ? { user_id: userIdFilter } : {}),
        status: SocialPostStatus.FAILED,
        updated_at: { gte: oneDayAgo },
      },
      orderBy: { updated_at: 'desc' },
      include: { account: { select: { name: true, platform: true } } },
    });
  }

  /**
   * User cần được báo real-time khi 1 post của `ownerId` chuyển sang FAILED — khớp đúng
   * phạm vi ai nhìn thấy notification này qua getNotifications()/resolveUserIds(): chính
   * chủ post + mọi ADMIN/MANAGER (thấy toàn hệ thống) + LEADER cùng team với chủ post.
   */
  async getFailedPostAudience(ownerId: string): Promise<string[]> {
    const owner = await this.prisma.user.findUnique({ where: { id: ownerId }, select: { team: true } });
    const privileged = await this.prisma.user.findMany({
      where: {
        is_active: true,
        id: { not: ownerId },
        OR: [
          { roles: { hasSome: [UserRole.ADMIN, UserRole.MANAGER] } },
          ...(owner?.team ? [{ roles: { has: UserRole.LEADER }, team: owner.team }] : []),
        ],
      },
      select: { id: true },
    });
    return [ownerId, ...privileged.map((u) => u.id)];
  }

  /** Danh sách nhân viên để filter (chỉ ADMIN/MANAGER/LEADER) */
  async getMembers(callerId: string, callerRoles: string[], teamFilter?: string) {
    if (!isPrivileged(callerRoles)) {
      throw new ForbiddenException('Không có quyền xem danh sách thành viên');
    }

    const where: any = { is_active: true };

    // LEADER chỉ thấy team mình (hoặc team đang filter — nhưng vẫn là team mình)
    if (isLeader(callerRoles)) {
      const leaderTeam = await this.getCallerTeam(callerId);
      where.team = teamFilter && teamFilter === leaderTeam ? teamFilter : leaderTeam;
    } else if (teamFilter) {
      where.team = teamFilter;
    }

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        full_name: true,
        email: true,
        team: true,
        roles: true,
        image_url: true,
      },
      orderBy: [{ team: 'asc' }, { full_name: 'asc' }],
    });
  }

  /** Danh sách team duy nhất (chỉ ADMIN/MANAGER/LEADER) */
  async getTeams(callerId: string, callerRoles: string[]) {
    if (!isPrivileged(callerRoles)) return [];

    // LEADER chỉ thấy team mình
    if (isLeader(callerRoles)) {
      const leaderTeam = await this.getCallerTeam(callerId);
      return leaderTeam ? [leaderTeam] : [];
    }

    const rows = await this.prisma.user.findMany({
      where: { is_active: true, team: { not: null } },
      select: { team: true },
      distinct: ['team'],
      orderBy: { team: 'asc' },
    });
    return rows.map(r => r.team).filter(Boolean);
  }
}
