import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PublishService } from '../publish/publish.service';
import { SocialPostStatus, SocialPostSource } from '@prisma/client';
import { PLATFORM_CONCURRENCY, GLOBAL_CONCURRENCY } from '../queue/queue.service';

const MAX_RETRIES = 3;
const MAX_HEAVY_JOBS = 5;

function extractDriveFileId(url: string): string | null {
  if (!url) return null;
  try {
    const id = new URL(url).searchParams.get('id');
    if (id) return id;
  } catch {}
  const m = url.match(/\/file\/d\/([^/?#]+)/);
  return m?.[1] || null;
}

/** Exponential backoff: attempt 1→5min, 2→15min, 3→45min */
function retryDelayMs(attempt: number): number {
  return Math.min(5 * Math.pow(3, attempt - 1) * 60 * 1000, 2 * 60 * 60 * 1000);
}

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);
  private isExecuting = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publishService: PublishService,
  ) {}

  // ─── CRUD API ────────────────────────────────────────────────────────────────

  async create(userId: string, dto: {
    accountId: string; message: string; mediaUrls?: string[];
    pageId?: string; privacy?: string; scheduledAt: string; thumbUrl?: string;
  }) {
    const scheduledAt = new Date(dto.scheduledAt);
    if (isNaN(scheduledAt.getTime())) throw new BadRequestException('scheduledAt không hợp lệ, hãy dùng định dạng ISO 8601 (vd: 2025-05-18T10:00:00+07:00)');
    if (scheduledAt <= new Date()) throw new BadRequestException('scheduledAt phải là thời điểm trong tương lai');

    const account = await this.prisma.socialAccount.findFirst({
      where: {
        id: dto.accountId,
        is_active: true,
        OR: [{ user_id: userId }, { is_shared: true } as any],
      },
    });
    if (!account) throw new NotFoundException('Account không tồn tại hoặc đã bị ngắt kết nối');

    let thumbUrl = dto.thumbUrl || null;
    if (!thumbUrl && dto.mediaUrls?.length) {
      const fileId = extractDriveFileId(dto.mediaUrls[0]);
      if (fileId) {
        const uploaded = await (this.prisma as any).socialUploadedFile?.findFirst?.({
          where: { OR: [{ drive_file_id: fileId }, { url: dto.mediaUrls[0] }] },
          select: { thumbnail_url: true },
        }).catch(() => null);
        thumbUrl = uploaded?.thumbnail_url ?? null;
      }
    }

    return this.prisma.socialPost.create({
      data: {
        user_id:      userId,
        account_id:   dto.accountId,
        platform:     account.platform,
        message:      dto.message,
        media_urls:   dto.mediaUrls ?? [],
        page_id:      dto.pageId,
        privacy:      dto.privacy,
        thumb_url:    thumbUrl,
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
    const now = new Date();
    const post = await this.prisma.socialPost.findFirst({
      where: {
        id, user_id: userId, status: SocialPostStatus.PENDING,
        // Không cho sửa post đang được worker xử lý (next_retry_at > now = đang claimed)
        OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }],
      },
    });
    if (!post) throw new NotFoundException('Task không tồn tại, không ở trạng thái PENDING, hoặc đang được xử lý');

    const data: any = { updated_at: new Date() };
    if (dto.message !== undefined && dto.message !== '') data.message = dto.message;
    if (dto.mediaUrls)  data.media_urls = dto.mediaUrls;
    if (dto.scheduledAt) {
      const d = new Date(dto.scheduledAt);
      if (isNaN(d.getTime())) throw new BadRequestException('scheduledAt không hợp lệ, hãy dùng định dạng ISO 8601');
      if (d <= new Date()) throw new BadRequestException('scheduledAt phải ở tương lai');
      data.scheduled_at = d;
      // Reset next_retry_at để tránh post bị kẹt ở retry cũ khi reschedule
      data.next_retry_at = null;
    }

    return this.prisma.socialPost.update({ where: { id }, data });
  }

  async cancel(id: string, userId: string) {
    const now = new Date();
    const post = await this.prisma.socialPost.findFirst({
      where: {
        id, user_id: userId, status: SocialPostStatus.PENDING,
        OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }],
      },
    });
    if (!post) throw new NotFoundException('Task không tồn tại hoặc đang được xử lý');
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
        status:        SocialPostStatus.PENDING,
        retry_count:   0,
        error_msg:     null,
        next_retry_at: null,
        scheduled_at:  new Date(Date.now() + retryDelayMs(1)),
        updated_at:    new Date(),
      },
    });
  }

  // ─── WORKER: chạy mỗi 5 giây ────────────────────────────────────────────────

  /** Trigger worker ngay lập tức (non-blocking) — gọi sau khi enqueue mới để giảm độ trễ */
  triggerNow(): void {
    setImmediate(() =>
      this.checkAndExecute().catch((err: any) =>
        this.logger.warn(`[Worker] triggerNow error: ${err?.message}`),
      ),
    );
  }

  @Cron('*/5 * * * * *')
  async checkAndExecute() {
    if (this.isExecuting) return;
    this.isExecuting = true;
    try {
      await this._doCheckAndExecute();
    } finally {
      this.isExecuting = false;
    }
  }

  private async _doCheckAndExecute() {
    const now        = new Date();
    // Video lớn cần download từ Drive + upload lên MXH → có thể mất 20-30 phút
    const claimUntil = new Date(Date.now() + 40 * 60 * 1000); // claim 40 phút

    // 1. Đếm số job đang xử lý (đã claim gần đây ≤ 40 phút) theo platform
    const inFlightRows = await this.prisma.socialPost.groupBy({
      by: ['platform'],
      where: {
        status:        SocialPostStatus.PENDING,
        next_retry_at: { gt: now, lte: claimUntil },
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

    // 4. Pre-warm: khởi động download Drive cho tất cả posts ngay bây giờ (non-blocking)
    // → chunk 2, 3... sẽ tìm thấy file đã download sẵn trong cache khi đến lượt
    this.publishService.preWarmDownloads(
      claimedPosts.map(p => ({ platform: p.platform, media_urls: (p.media_urls as string[]) ?? [] })),
    );

    // 5. Chạy tuần tự theo nhóm để tránh quá tải RAM (Heavy Jobs Control)
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

      // Bước 1: Lưu result vào DB trước — idempotency check sẽ dùng field này
      // nếu Bước 2 thất bại (mất kết nối DB), lần retry sau sẽ thấy result và không đăng lại
      await this.prisma.socialPost.updateMany({
        where: { id: post.id },
        data: { result, updated_at: new Date() },
      }).catch((e: any) => this.logger.warn(`[Worker] Lưu result tạm cho ${post.id} thất bại: ${e.message}`));

      // Bước 2: Mark COMPLETED
      const updated = await this.prisma.socialPost.updateMany({
        where: { id: post.id, status: SocialPostStatus.PENDING },
        data: {
          status:        SocialPostStatus.COMPLETED,
          executed_at:   new Date(),
          updated_at:    new Date(),
          next_retry_at: null,
          error_msg:     null,
          retry_count:   0,
        },
      });
      if (updated.count === 0) {
        this.logger.warn(`[Worker] ⚠️ Post ${post.id} published but DB record missing — skipping archive`);
        return;
      }
      this.publishService.archiveMediaAsync(post.id, (post.media_urls as string[]) ?? [])
        .catch((err: any) => this.logger.warn(`[Worker] archiveMediaAsync failed for ${post.id}: ${err.message}`));
      this.logger.log(`[Worker] ✅ Post ${post.id} (${post.platform}) completed`);
    } catch (err: any) {
      const stackLines = (err.stack || '').split('\n').slice(0, 6).join('\n  ');
      this.logger.error(`[Worker] ✗ Post ${post.id} (${post.platform}) THẤT BẠI:\n  Lỗi: ${err.message}\n  Stack:\n  ${stackLines}`);
      const retryCount = (post.retry_count ?? 0) + 1;
      const errorWithStack = `${err.message} | stack: ${(err.stack || '').split('\n').slice(1, 4).join(' | ')}`;
      try {
        if (retryCount >= MAX_RETRIES) {
          await this.prisma.socialPost.updateMany({
            where: { id: post.id },
            data: {
              status:        SocialPostStatus.FAILED,
              retry_count:   retryCount,
              error_msg:     errorWithStack,
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
    // SCHEDULED: giữ 7 ngày
    const scheduledCutoff  = new Date(now - 7  * 24 * 60 * 60 * 1000);
    // IMMEDIATE: giữ 30 ngày (editor cần xem lại lịch sử đăng bài)
    const immediateCutoff  = new Date(now - 30 * 24 * 60 * 60 * 1000);
    // FAILED: giữ 30 ngày rồi xóa (cả SCHEDULED lẫn IMMEDIATE)
    const failedCutoff     = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [s, i, f] = await Promise.all([
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
      // FAILED posts chưa từng được cleanup — xóa sau 30 ngày để tránh DB phình
      this.prisma.socialPost.deleteMany({
        where: {
          status:     SocialPostStatus.FAILED,
          updated_at: { lt: failedCutoff },
        },
      }),
    ]);

    const total = s.count + i.count + f.count;
    if (total > 0) this.logger.log(`[Cleanup] Deleted ${s.count} scheduled + ${i.count} immediate + ${f.count} failed old posts`);
  }
}
