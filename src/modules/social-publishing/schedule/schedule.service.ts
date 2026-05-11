import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PublishService } from '../publish/publish.service';
import { SocialPlatform, SocialPostStatus, SocialPostSource } from '@prisma/client';
import { PLATFORM_CONCURRENCY, GLOBAL_CONCURRENCY } from '../queue/queue.service';

const MAX_RETRIES = 3;
const MAX_HEAVY_JOBS = 2;

/** Exponential backoff: attempt 1→5min, 2→15min, 3→45min */
function retryDelayMs(attempt: number): number {
  return Math.min(5 * Math.pow(3, attempt - 1) * 60 * 1000, 2 * 60 * 60 * 1000);
}

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publishService: PublishService,
  ) {}

  // ─── CRUD API ────────────────────────────────────────────────────────────────

  async create(userId: string, dto: {
    accountId: string; message: string; mediaUrls?: string[];
    pageId?: string; privacy?: string; scheduledAt: string;
  }) {
    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt <= new Date()) throw new BadRequestException('scheduledAt phải là thời điểm trong tương lai');

    const account = await this.prisma.socialAccount.findFirst({ where: { id: dto.accountId, user_id: userId } });
    if (!account) throw new NotFoundException('Account không tồn tại');

    return this.prisma.socialPost.create({
      data: {
        user_id:      userId,
        account_id:   dto.accountId,
        platform:     account.platform,
        message:      dto.message,
        media_urls:   dto.mediaUrls ?? [],
        page_id:      dto.pageId,
        privacy:      dto.privacy,
        scheduled_at: scheduledAt,
        source:       SocialPostSource.SCHEDULED,
        status:       SocialPostStatus.PENDING,
        updated_at:   new Date(),
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.socialPost.findMany({
      where: { user_id: userId, source: SocialPostSource.SCHEDULED },
      orderBy: { scheduled_at: 'asc' },
      include: { account: { select: { name: true, username: true, avatar_url: true, platform: true } } },
    });
  }

  async update(id: string, userId: string, dto: { message?: string; scheduledAt?: string; mediaUrls?: string[] }) {
    const post = await this.prisma.socialPost.findFirst({ where: { id, user_id: userId, status: SocialPostStatus.PENDING } });
    if (!post) throw new NotFoundException('Task không tồn tại hoặc không ở trạng thái PENDING');

    const data: any = { updated_at: new Date() };
    if (dto.message)    data.message = dto.message;
    if (dto.mediaUrls)  data.media_urls = dto.mediaUrls;
    if (dto.scheduledAt) {
      const d = new Date(dto.scheduledAt);
      if (d <= new Date()) throw new BadRequestException('scheduledAt phải ở tương lai');
      data.scheduled_at = d;
    }

    return this.prisma.socialPost.update({ where: { id }, data });
  }

  async cancel(id: string, userId: string) {
    const post = await this.prisma.socialPost.findFirst({ where: { id, user_id: userId, status: SocialPostStatus.PENDING } });
    if (!post) throw new NotFoundException('Task không tồn tại');
    return this.prisma.socialPost.update({
      where: { id },
      data: { status: SocialPostStatus.CANCELLED, updated_at: new Date() },
    });
  }

  async retry(id: string, userId: string) {
    const post = await this.prisma.socialPost.findFirst({ where: { id, user_id: userId, status: SocialPostStatus.FAILED } });
    if (!post) throw new NotFoundException('Task không tồn tại hoặc chưa failed');
    return this.prisma.socialPost.update({
      where: { id },
      data: {
        status:       SocialPostStatus.PENDING,
        retry_count:  0,
        error_msg:    null,
        scheduled_at: new Date(Date.now() + retryDelayMs(1)),
        updated_at:   new Date(),
      },
    });
  }

  // ─── WORKER: chạy mỗi 10 giây ───────────────────────────────────────────────

  @Cron('*/10 * * * * *')
  async checkAndExecute() {
    const now        = new Date();
    const claimUntil = new Date(Date.now() + 10 * 60 * 1000); // claim 10 phút

    // 1. Đếm số job đang xử lý (đã claim) theo platform
    const inFlightRows = await this.prisma.socialPost.groupBy({
      by: ['platform'],
      where: {
        status:        SocialPostStatus.PENDING,
        next_retry_at: { gt: now },
      },
      _count: { platform: true },
    });

    const inFlight: Record<string, number> = {};
    let totalInFlight = 0;
    for (const r of inFlightRows) {
      inFlight[r.platform] = r._count.platform;
      totalInFlight += r._count.platform;
    }

    // Nếu đã đạt global limit thì dừng
    if (totalInFlight >= GLOBAL_CONCURRENCY) return;

    // 2. Lấy các job đến hạn (SCHEDULED + IMMEDIATE), sắp theo thời gian tạo
    const duePosts = await this.prisma.socialPost.findMany({
      where: {
        status:       SocialPostStatus.PENDING,
        source:       { in: [SocialPostSource.SCHEDULED, SocialPostSource.IMMEDIATE] },
        scheduled_at: { lte: now },
        OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }],
      },
      orderBy: { scheduled_at: 'asc' },
      take: 50,
    });

    if (duePosts.length === 0) return;

    // 3. Claim từng job — tôn trọng giới hạn platform và global
    const claimedIds: string[]          = [];
    const claimedPerPlatform: Record<string, number> = {};

    for (const post of duePosts) {
      if (totalInFlight + claimedIds.length >= GLOBAL_CONCURRENCY) break;

      const platformLimit    = PLATFORM_CONCURRENCY[post.platform] ?? 3;
      const currentInFlight  = (inFlight[post.platform] ?? 0) + (claimedPerPlatform[post.platform] ?? 0);
      if (currentInFlight >= platformLimit) continue; // platform đầy slot

      // Atomic claim: chỉ thành công nếu next_retry_at chưa thay đổi
      const claimed = await this.prisma.socialPost.updateMany({
        where: {
          id:            post.id,
          status:        SocialPostStatus.PENDING,
          next_retry_at: post.next_retry_at ?? null,
        },
        data: { next_retry_at: claimUntil },
      });

      if (claimed.count === 1) {
        claimedIds.push(post.id);
        claimedPerPlatform[post.platform] = (claimedPerPlatform[post.platform] ?? 0) + 1;
      }
    }

    if (claimedIds.length === 0) return;

    const claimedPosts = duePosts.filter(p => claimedIds.includes(p.id));
    this.logger.log(
      `[Worker] Claimed ${claimedPosts.length} jobs | ` +
      Object.entries(claimedPerPlatform).map(([p, n]) => `${p}:${n}`).join(', '),
    );

    // 4. Chạy tuần tự theo nhóm để tránh quá tải RAM (Heavy Jobs Control)
    for (let i = 0; i < claimedPosts.length; i += MAX_HEAVY_JOBS) {
      const chunk = claimedPosts.slice(i, i + MAX_HEAVY_JOBS);
      await Promise.all(chunk.map(post => this.executePost(post)));
    }
  }

  private async executePost(post: any) {
    // Idempotency: nếu đã có result → đã publish thành công nhưng DB update bị fail trước đó
    if (post.result && typeof post.result === 'object' && Object.keys(post.result as any).length > 0) {
      this.logger.warn(`[Worker] ⚠️ Post ${post.id} already has result — marking COMPLETED without re-publish`);
      await this.prisma.socialPost.updateMany({
        where: { id: post.id },
        data: { status: SocialPostStatus.COMPLETED, executed_at: new Date(), updated_at: new Date(), next_retry_at: null },
      });
      return;
    }

    try {
      this.logger.log(`[Worker] ▶ Đang publish post ${post.id} | platform=${post.platform} | media=${post.media_urls?.length ?? 0} file`);
      const result = await this.publishService.executeScheduled(post);
      const updated = await this.prisma.socialPost.updateMany({
        where: { id: post.id },
        data: {
          status:        SocialPostStatus.COMPLETED,
          result,
          executed_at:   new Date(),
          updated_at:    new Date(),
          next_retry_at: null,
        },
      });
      if (updated.count === 0) {
        this.logger.warn(`[Worker] ⚠️ Post ${post.id} published but DB record missing — skipping archive`);
        return;
      }
      this.publishService.archiveMediaAsync(post.id, (post.media_urls as string[]) ?? []);
      this.logger.log(`[Worker] ✅ Post ${post.id} (${post.platform}) completed`);
    } catch (err: any) {
      this.logger.error(`[Worker] ✗ Post ${post.id} (${post.platform}) THẤT BẠI:\n  Lỗi: ${err.message}\n  Stack: ${err.stack?.split('\n')[1]?.trim() ?? ''}`);
      const retryCount = (post.retry_count ?? 0) + 1;
      try {
        if (retryCount >= MAX_RETRIES) {
          await this.prisma.socialPost.updateMany({
            where: { id: post.id },
            data: {
              status:        SocialPostStatus.FAILED,
              retry_count:   retryCount,
              error_msg:     err.message,
              updated_at:    new Date(),
              next_retry_at: null,
            },
          });
          this.logger.warn(`[Worker] ❌ Post ${post.id} failed after ${MAX_RETRIES} retries: ${err.message}`);
        } else {
          await this.prisma.socialPost.updateMany({
            where: { id: post.id },
            data: {
              retry_count:   retryCount,
              next_retry_at: new Date(Date.now() + retryDelayMs(retryCount)),
              error_msg:     err.message,
              updated_at:    new Date(),
            },
          });
          this.logger.warn(`[Worker] ⚠️ Post ${post.id} retry ${retryCount}/${MAX_RETRIES} in ${retryDelayMs(retryCount) / 60000}min: ${err.message}`);
        }
      } catch (dbErr: any) {
        this.logger.error(`[Worker] ❌ Post ${post.id} — publish error: ${err.message} | DB update error: ${dbErr.message}`);
      }
    }
  }

  // ─── DỌN DẸP: mỗi giờ ──────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupOldPosts() {
    const now = Date.now();
    // SCHEDULED: giữ 7 ngày (ít quan trọng hơn trong history)
    const scheduledCutoff = new Date(now - 7  * 24 * 60 * 60 * 1000);
    // IMMEDIATE: giữ 30 ngày (editor cần xem lại lịch sử đăng bài)
    const immediateCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [s, i] = await Promise.all([
      this.prisma.socialPost.deleteMany({
        where: {
          source:     SocialPostSource.SCHEDULED,
          status:     { in: [SocialPostStatus.COMPLETED, SocialPostStatus.CANCELLED] },
          updated_at: { lt: scheduledCutoff },
        },
      }),
      this.prisma.socialPost.deleteMany({
        where: {
          source:     SocialPostSource.IMMEDIATE,
          status:     { in: [SocialPostStatus.COMPLETED, SocialPostStatus.CANCELLED] },
          updated_at: { lt: immediateCutoff },
        },
      }),
    ]);

    const total = s.count + i.count;
    if (total > 0) this.logger.log(`[Cleanup] Deleted ${s.count} scheduled + ${i.count} immediate old posts`);
  }
}
