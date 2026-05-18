import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SocialPostStatus } from '@prisma/client';

export interface HistoryFilter {
  team?: string;
  employeeId?: string;
}

const PRIVILEGED_ROLES = ['ADMIN', 'MANAGER', 'LEADER'];

function isPrivileged(roles: string[]): boolean {
  return roles.some(r => PRIVILEGED_ROLES.includes(r));
}

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve danh sách user_id cần filter:
   * - MEMBER       → chỉ chính họ
   * - ADMIN/MANAGER/LEADER + employeeId → chỉ nhân viên đó
   * - ADMIN/MANAGER/LEADER + team       → tất cả user trong team
   * - ADMIN/MANAGER/LEADER + không filter → undefined (không lọc = tất cả)
   */
  private async resolveUserIds(
    callerId: string,
    callerRoles: string[],
    filter: HistoryFilter,
  ): Promise<{ in: string[] } | undefined> {
    if (!isPrivileged(callerRoles)) {
      return { in: [callerId] };
    }

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

    return undefined; // không lọc → trả tất cả
  }

  async findAll(userId: string, callerRoles: string[], filter: HistoryFilter = {}, limit = 50) {
    const userIdFilter = await this.resolveUserIds(userId, callerRoles, filter);
    return this.prisma.socialPost.findMany({
      where: { ...(userIdFilter ? { user_id: userIdFilter } : {}) },
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        account: { select: { name: true, username: true, avatar_url: true, platform: true } },
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

  /** Danh sách nhân viên để filter (chỉ ADMIN/MANAGER/LEADER) */
  async getMembers(_callerId: string, callerRoles: string[], teamFilter?: string) {
    if (!isPrivileged(callerRoles)) {
      throw new ForbiddenException('Không có quyền xem danh sách thành viên');
    }
    const where: any = { is_active: true };
    if (teamFilter) where.team = teamFilter;
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
  async getTeams(_callerId: string, callerRoles: string[]) {
    if (!isPrivileged(callerRoles)) return [];
    const rows = await this.prisma.user.findMany({
      where: { is_active: true, team: { not: null } },
      select: { team: true },
      distinct: ['team'],
      orderBy: { team: 'asc' },
    });
    return rows.map(r => r.team).filter(Boolean);
  }
}
