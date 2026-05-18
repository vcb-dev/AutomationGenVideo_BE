import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SocialPlatform, SocialPostSource, SocialPostStatus } from '@prisma/client';

/** Số job tối đa chạy đồng thời trên mỗi platform */
export const PLATFORM_CONCURRENCY: Record<string, number> = {
  FACEBOOK:  6,
  INSTAGRAM: 3,
  TIKTOK:    2,
  YOUTUBE:   2,
  THREADS:   4,
  ZALO:      5,
};

/** Tổng số job tối đa chạy đồng thời toàn hệ thống */
export const GLOBAL_CONCURRENCY = 15;

export interface EnqueueJobDto {
  accountId: string;
  platform: SocialPlatform;
  message: string;
  mediaUrls?: string[];
  privacy?: string;
  pageId?: string;
}

export interface JobStatus {
  id: string;
  status: SocialPostStatus;
  platform: SocialPlatform;
  error_msg: string | null;
  result: any;
  executed_at: Date | null;
  queuePosition: number | null;
  queueTotal: number | null;
  account: { name: string; platform: SocialPlatform } | null;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Thêm nhiều jobs vào hàng chờ, trả về danh sách job IDs */
  async enqueue(userId: string, jobs: EnqueueJobDto[]): Promise<string[]> {
    const now = new Date();
    const created = await Promise.all(
      jobs.map(job =>
        this.prisma.socialPost.create({
          data: {
            user_id:    userId,
            account_id: job.accountId,
            platform:   job.platform,
            source:     SocialPostSource.IMMEDIATE,
            status:     SocialPostStatus.PENDING,
            message:    job.message,
            media_urls: job.mediaUrls ?? [],
            privacy:    job.privacy,
            page_id:    job.pageId,
            scheduled_at: now,
            updated_at:   now,
          },
        }),
      ),
    );
    this.logger.log(`[Queue] Enqueued ${created.length} jobs for user ${userId}`);
    return created.map(p => p.id);
  }

  /** Lấy trạng thái của nhiều jobs, kèm vị trí hàng chờ */
  async getJobsStatus(jobIds: string[], userId: string): Promise<JobStatus[]> {
    const posts = await this.prisma.socialPost.findMany({
      where: { id: { in: jobIds }, user_id: userId },
      select: {
        id: true,
        status: true,
        platform: true,
        error_msg: true,
        result: true,
        executed_at: true,
        account: { select: { name: true, platform: true } },
      },
    });

    // Với các job còn PENDING, tính vị trí trong hàng chờ theo platform
    // Dùng 1 query duy nhất thay vì N+1
    const pendingPlatforms = [
      ...new Set(posts.filter(p => p.status === 'PENDING').map(p => p.platform)),
    ];

    const queueByPlatform: Record<string, string[]> = {};
    if (pendingPlatforms.length > 0) {
      const allPendingQueue = await this.prisma.socialPost.findMany({
        where: {
          status: SocialPostStatus.PENDING,
          platform: { in: pendingPlatforms },
          scheduled_at: { lte: new Date() },
          OR: [{ next_retry_at: null }, { next_retry_at: { lte: new Date() } }],
        },
        orderBy: { scheduled_at: 'asc' },
        select: { id: true, platform: true },
      });
      for (const p of allPendingQueue) {
        if (!queueByPlatform[p.platform]) queueByPlatform[p.platform] = [];
        queueByPlatform[p.platform].push(p.id);
      }
    }

    return posts.map(post => {
      const platformQueue = queueByPlatform[post.platform] ?? [];
      const posIdx = platformQueue.indexOf(post.id);
      return {
        ...post,
        result: post.result as any,
        queuePosition: post.status === 'PENDING' && posIdx !== -1 ? posIdx + 1 : null,
        queueTotal:    post.status === 'PENDING' ? platformQueue.length : null,
      } as JobStatus;
    });
  }

  /** Thống kê hàng chờ hiện tại (cho admin) */
  async getQueueStats() {
    const now = new Date();
    const [pending, inFlight] = await Promise.all([
      this.prisma.socialPost.groupBy({
        by: ['platform'],
        where: {
          status: SocialPostStatus.PENDING,
          OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }],
        },
        _count: { platform: true },
      }),
      this.prisma.socialPost.groupBy({
        by: ['platform'],
        where: {
          status: SocialPostStatus.PENDING,
          next_retry_at: { gt: now },
        },
        _count: { platform: true },
      }),
    ]);

    const stats: Record<string, { waiting: number; processing: number; limit: number }> = {};
    for (const p of Object.keys(PLATFORM_CONCURRENCY)) {
      stats[p] = {
        waiting:    pending.find(r => r.platform === p)?._count.platform ?? 0,
        processing: inFlight.find(r => r.platform === p)?._count.platform ?? 0,
        limit:      PLATFORM_CONCURRENCY[p],
      };
    }
    return stats;
  }
}
