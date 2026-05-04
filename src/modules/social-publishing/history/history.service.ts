import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SocialPostSource, SocialPostStatus } from '@prisma/client';

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string, limit = 50) {
    return this.prisma.socialPost.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
      include: { account: { select: { name: true, username: true, avatar_url: true, platform: true } } },
    });
  }

  async getStats(userId: string) {
    const [statusCounts, platformCounts] = await Promise.all([
      this.prisma.socialPost.groupBy({
        by: ['status'],
        where: { user_id: userId },
        _count: { status: true },
      }),
      this.prisma.socialPost.groupBy({
        by: ['platform'],
        where: { user_id: userId },
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

  async getNotifications(userId: string) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.prisma.socialPost.findMany({
      where: { user_id: userId, status: SocialPostStatus.FAILED, updated_at: { gte: oneDayAgo } },
      orderBy: { updated_at: 'desc' },
      include: { account: { select: { name: true, platform: true } } },
    });
  }
}
