import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SyncRange } from './facebook-ai-client.service';
import { FacebookOwnedPagesService } from './facebook-owned-pages.service';
import { FacebookOwnedPagesReadService, VideoFilterParams, videoFilterConditions } from './facebook-owned-pages-read.service';

/** Trần số video kéo lại chỉ số trong 1 lượt bấm — mỗi 50 video là 1 lượt gọi Graph API. */
export const MAX_METRIC_VIDEOS = 1000;
/** Số page cào song song ở bước 1 (mỗi page 1 lượt gọi AI, vài giây tới vài chục giây). */
const SYNC_CONCURRENCY = 3;
/** Trần số bài/page cho 1 lượt — lọc cả năm thì chỉ lấy phần mới nhất trong khoảng. */
export const REFRESH_MAX_POSTS_PER_PAGE = 500;
/** Bộ lọc không chọn "từ ngày" thì cào lùi ngần này ngày. */
const REFRESH_DEFAULT_DAYS = 7;
/** Giới hạn số lượt cập nhật chạy cùng lúc toàn hệ thống — bảo vệ quota Graph API. */
const MAX_RUNNING_JOBS = 3;
/** Giữ kết quả lượt đã xong bấy lâu để FE (kể cả mở lại tab) còn đọc được. */
const JOB_TTL_MS = 30 * 60_000;

export interface RefreshUser {
  id: string;
  roles: UserRole[];
}

export interface RefreshParams extends VideoFilterParams {
  team_id?: string;
  owner_id?: string;
}

export interface RefreshJob {
  id: string;
  user_id: string;
  status: 'running' | 'done' | 'failed';
  started_at: Date;
  finished_at: Date | null;
  /** Luôn true — giữ field cho FE cũ. */
  sync_new: boolean;
  pages_total: number;
  pages_done: number;
  pages_failed: number;
  /** Page chưa có token / ngừng hoạt động — không cập nhật được */
  pages_skipped: number;
  new_videos: number;
  metrics_total: number;
  metrics_done: number;
  metrics_updated: number;
  /** Số video khớp bộ lọc vượt MAX_METRIC_VIDEOS — chỉ lấy phần mới đăng nhất */
  capped: boolean;
  errors: string[];
}

type ScopePage = Awaited<ReturnType<FacebookOwnedPagesReadService['resolveScopePages']>>[number];

interface MetricVideoRow {
  id: bigint;
  managed_page_id: bigint;
  post_id: string;
  view_count: bigint;
  like_count: number;
  comment_count: number;
  share_count: number;
}

/**
 * Nút "Cập nhật" ở tab Video đã đăng, chạy nền (~100 page mất vài phút), FE hỏi tiến độ qua job id:
 * 1. Cào lại mọi bài trong khoảng ngày đang lọc cho page thuộc phạm vi.
 * 2. Kéo lại chỉ số cho video khớp mọi bộ lọc.
 * Phạm vi bị ép theo quyền ở đây (không tin FE). Job giữ trong bộ nhớ — restart thì mất trạng thái.
 */
@Injectable()
export class PublishedVideosRefreshService {
  private readonly logger = new Logger(PublishedVideosRefreshService.name);
  private readonly jobs = new Map<string, RefreshJob>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly readService: FacebookOwnedPagesReadService,
    private readonly pagesService: FacebookOwnedPagesService,
  ) {}

  async start(user: RefreshUser, params: RefreshParams): Promise<RefreshJob> {
    this.dropExpired();
    const mine = this.latestFor(user.id);
    if (mine?.status === 'running') return mine;
    const running = [...this.jobs.values()].filter((j) => j.status === 'running').length;
    if (running >= MAX_RUNNING_JOBS) {
      throw new HttpException('Đang có nhiều lượt cập nhật chạy cùng lúc, thử lại sau ít phút', HttpStatus.TOO_MANY_REQUESTS);
    }

    const scope = await this.resolveScope(user, params);
    const pages = await this.readService.resolveScopePages(scope.teamIds, scope.ownerId);
    const usable = pages.filter((p) => p.is_active && p.page_access_token);

    const job: RefreshJob = {
      id: randomUUID(),
      user_id: user.id,
      status: 'running',
      started_at: new Date(),
      finished_at: null,
      sync_new: true,
      pages_total: usable.length,
      pages_done: 0,
      pages_failed: 0,
      pages_skipped: pages.length - usable.length,
      new_videos: 0,
      metrics_total: 0,
      metrics_done: 0,
      metrics_updated: 0,
      capped: false,
      errors: [],
    };
    this.jobs.set(job.id, job);

    this.run(job, usable, params).catch((err) => {
      job.status = 'failed';
      job.finished_at = new Date();
      job.errors.push(err?.message || String(err));
      this.logger.error(`[VIDEO-REFRESH] ${job.id} thất bại: ${err?.message}`);
    });
    return job;
  }

  getJob(id: string, user: RefreshUser): RefreshJob {
    const job = this.jobs.get(id);
    if (!job || (job.user_id !== user.id && !isAdminOrManager(user.roles))) throw new NotFoundException();
    return job;
  }

  /** Lượt gần nhất của user (đang chạy hoặc vừa xong) — FE mở lại tab thì bám tiếp. */
  latestFor(userId: string): RefreshJob | null {
    this.dropExpired();
    let latest: RefreshJob | null = null;
    for (const j of this.jobs.values()) {
      if (j.user_id === userId && (!latest || j.started_at > latest.started_at)) latest = j;
    }
    return latest;
  }

  async resolveScope(user: RefreshUser, params: RefreshParams): Promise<{ teamIds: string[]; ownerId?: string }> {
    const teamIds = (params.team_id || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ownerId = (params.owner_id || '').trim() || undefined;
    if (isAdminOrManager(user.roles)) return { teamIds, ownerId };

    if (user.roles.includes(UserRole.LEADER)) {
      const led = (await this.prisma.team.findMany({ where: { leader_id: user.id }, select: { id: true } })).map((t) => t.id);
      if (led.length) {
        const allowed = teamIds.length ? teamIds.filter((t) => led.includes(t)) : led;
        if (!allowed.length) throw new ForbiddenException('Chỉ cập nhật được video của team bạn quản lý');
        return { teamIds: allowed, ownerId };
      }
    }
    // Thành viên (hoặc leader chưa quản lý team nào): chỉ page chính mình cầm
    return { teamIds: [], ownerId: user.id };
  }

  private async run(job: RefreshJob, pages: ScopePage[], params: RefreshParams) {
    const scopeLabel = `${pages.length} page`;
    this.logger.log(`[VIDEO-REFRESH] ${job.id} bắt đầu — ${scopeLabel}, cào bài mới: ${job.sync_new}`);

    // Bước 1 — cào lại khoảng ngày đang lọc; page đang bị nơi khác cào thì bỏ qua bước này.
    if (job.sync_new) {
      const range = refreshSyncRange(params);
      await forEachLimit(pages, SYNC_CONCURRENCY, async (p) => {
        try {
          if (!p.is_scraping) {
            const r = await this.pagesService.syncPage(p.page_id, REFRESH_MAX_POSTS_PER_PAGE, range);
            job.new_videos += r.created;
          }
        } catch (err: any) {
          job.pages_failed++;
          this.noteError(job, `${p.name}: ${err?.message || err}`);
        } finally {
          job.pages_done++;
        }
      });
    } else {
      job.pages_done = pages.length;
    }

    // Bước 2 — kéo lại chỉ số cho video khớp bộ lọc, mới đăng trước. Bỏ video vừa được bước 1
    // ghi (last_updated_at >= lúc bắt đầu) vì chỉ số của chúng vừa lấy xong.
    if (pages.length) {
      const conditions: Prisma.Sql[] = [
        Prisma.sql`managed_page_id IN (${Prisma.join(pages.map((p) => p.id))})`,
        Prisma.sql`(last_updated_at IS NULL OR last_updated_at < ${job.started_at})`,
        ...videoFilterConditions(params),
      ];
      const rows = await this.prisma.$queryRaw<MetricVideoRow[]>`
        SELECT id, managed_page_id, post_id, view_count, like_count, comment_count, share_count
        FROM video_management_ownedvideocontent
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY published_at DESC
        LIMIT ${MAX_METRIC_VIDEOS + 1}
      `;
      job.capped = rows.length > MAX_METRIC_VIDEOS;
      const videos = rows.slice(0, MAX_METRIC_VIDEOS);
      job.metrics_total = videos.length;

      const byPage = new Map<string, MetricVideoRow[]>();
      for (const v of videos) {
        const k = v.managed_page_id.toString();
        byPage.set(k, [...(byPage.get(k) ?? []), v]);
      }
      const pageById = new Map(pages.map((p) => [p.id.toString(), p]));
      for (const [pageId, vids] of byPage) {
        const page = pageById.get(pageId)!;
        try {
          job.metrics_updated += await this.pagesService.refreshMetricsForPage(page.page_access_token, vids);
        } catch (err: any) {
          this.noteError(job, `${page.name}: ${err?.message || err}`);
        } finally {
          job.metrics_done += vids.length;
        }
      }
    }

    job.status = 'done';
    job.finished_at = new Date();
    this.logger.log(
      `[VIDEO-REFRESH] ${job.id} xong — +${job.new_videos} video mới, ` +
        `${job.metrics_updated}/${job.metrics_total} video cập nhật chỉ số, ${job.errors.length} lỗi`,
    );
  }

  private noteError(job: RefreshJob, msg: string) {
    if (job.errors.length < 5) job.errors.push(msg.slice(0, 200));
  }

  private dropExpired() {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, j] of this.jobs) {
      if (j.finished_at && j.finished_at.getTime() < cutoff) this.jobs.delete(id);
    }
  }
}

function isAdminOrManager(roles: UserRole[]) {
  return roles.includes(UserRole.ADMIN) || roles.includes(UserRole.MANAGER);
}

/**
 * Khoảng bài đăng cần cào cho nút "Cập nhật", theo ngày giờ VN của bộ lọc: từ 00:00 `date_from`
 * (không chọn thì lùi REFRESH_DEFAULT_DAYS ngày) tới hết ngày `date_to` (không chọn, hoặc chưa
 * qua hết ngày đó, thì tới hiện tại).
 */
export function refreshSyncRange(
  params: { date_from?: string; date_to?: string },
  now: Date = new Date(),
): SyncRange {
  const zone = 'Asia/Ho_Chi_Minh';
  const from = DateTime.fromFormat((params.date_from || '').trim(), 'yyyy-MM-dd', { zone });
  const to = DateTime.fromFormat((params.date_to || '').trim(), 'yyyy-MM-dd', { zone });
  const since = from.isValid
    ? from.startOf('day')
    : DateTime.fromJSDate(now).setZone(zone).startOf('day').minus({ days: REFRESH_DEFAULT_DAYS });
  const until = to.isValid ? to.startOf('day').plus({ days: 1 }) : null;
  return {
    since: since.toJSDate(),
    ...(until && until.toMillis() < now.getTime() ? { until: until.toJSDate() } : {}),
  };
}

async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}
