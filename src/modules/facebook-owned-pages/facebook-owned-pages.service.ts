import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FacebookAiClientService } from './facebook-ai-client.service';

const STALE_LOCK_MINUTES = 30;

// Toàn bộ logic ghi DB port từ AI (video_management/services/facebook_fetcher.py +
// tasks.py phần "FACEBOOK SCRAPER — 4 PHASES"). AI giờ chỉ fetch + parse (facebook_fetch_views.py),
// BE là nơi duy nhất ghi video_management_managedfacebookpage / video_management_ownedvideocontent.
@Injectable()
export class FacebookOwnedPagesService {
  private readonly logger = new Logger(FacebookOwnedPagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: FacebookAiClientService,
  ) {}

  // ─── GĐ0: Import pages (phát hiện page mới từ /me/accounts) ──────────────

  async importManagedPages(userAccessToken?: string): Promise<{ created: number; updated: number; newPageIds: string[] }> {
    const { pages } = await this.aiClient.fetchManagedPages(userAccessToken);
    if (!pages?.length) return { created: 0, updated: 0, newPageIds: [] };

    let created = 0;
    let updated = 0;
    const newPageIds: string[] = [];
    const now = new Date();

    for (const p of pages) {
      const existing = await this.prisma.video_management_managedfacebookpage.findUnique({
        where: { page_id: p.page_id },
      });

      if (existing) {
        await this.prisma.video_management_managedfacebookpage.update({
          where: { page_id: p.page_id },
          data: {
            name: p.name,
            username: p.username,
            category: p.category,
            avatar_url: p.avatar_url,
            followers_count: BigInt(p.followers_count || 0),
            likes_count: BigInt(p.likes_count || 0),
            page_access_token: p.page_access_token_encrypted,
            is_active: true,
            raw_data: p.raw_data ?? {},
            updated_at: now,
          },
        });
        updated++;
      } else {
        await this.prisma.video_management_managedfacebookpage.create({
          data: {
            page_id: p.page_id,
            name: p.name,
            username: p.username,
            category: p.category,
            avatar_url: p.avatar_url,
            followers_count: BigInt(p.followers_count || 0),
            likes_count: BigInt(p.likes_count || 0),
            page_access_token: p.page_access_token_encrypted,
            tasks: [],
            is_active: true,
            is_backfilled: false,
            is_scraping: false,
            raw_data: p.raw_data ?? {},
            created_at: now,
            updated_at: now,
          },
        });
        created++;
        newPageIds.push(p.page_id);
      }
    }

    this.logger.log(`[IMPORT] +${created} page mới, ~${updated} cập nhật`);
    return { created, updated, newPageIds };
  }

  // ─── Lock helpers (is_scraping) ───────────────────────────────────────────

  async resetStaleLocks(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000);
    const result = await this.prisma.video_management_managedfacebookpage.updateMany({
      where: { is_scraping: true, updated_at: { lt: cutoff } },
      data: { is_scraping: false, updated_at: new Date() },
    });
    if (result.count > 0) {
      this.logger.warn(`⚠️ Reset ${result.count} page bị stuck lock`);
    }
  }

  private async lockPage(id: bigint): Promise<void> {
    await this.prisma.video_management_managedfacebookpage.update({
      where: { id },
      data: { is_scraping: true, scrape_error: null, updated_at: new Date() },
    });
  }

  private async unlockPage(id: bigint, error?: string): Promise<void> {
    const data: any = {
      is_scraping: false,
      scrape_error: error ? error.slice(0, 500) : null,
      updated_at: new Date(),
    };
    if (!error) data.last_scraped_at = new Date();
    await this.prisma.video_management_managedfacebookpage.update({ where: { id }, data });
  }

  // ─── Upsert 1 batch video vào OwnedVideoContent ──────────────────────────

  private async upsertVideos(managedPageId: bigint, videos: { post_id: string; caption: string; published_at: string; permalink_url: string; thumbnail_url: string; video_url: string; view_count: number; like_count: number; comment_count: number; share_count: number; raw_data: any }[]): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    const now = new Date();

    for (const v of videos) {
      const publishedAt = v.published_at ? new Date(v.published_at) : now;
      const existing = await this.prisma.video_management_ownedvideocontent.findUnique({
        where: { post_id: v.post_id },
      });

      const data = {
        managed_page_id: managedPageId,
        caption: v.caption || '',
        published_at: publishedAt,
        permalink_url: v.permalink_url || '',
        thumbnail_url: v.thumbnail_url || '',
        video_url: v.video_url || '',
        view_count: BigInt(v.view_count || 0),
        like_count: v.like_count || 0,
        comment_count: v.comment_count || 0,
        share_count: v.share_count || 0,
        raw_data: v.raw_data ?? {},
        last_updated_at: now,
        updated_at: now,
      };

      if (existing) {
        await this.prisma.video_management_ownedvideocontent.update({ where: { post_id: v.post_id }, data });
        updated++;
      } else {
        await this.prisma.video_management_ownedvideocontent.create({
          data: { ...data, post_id: v.post_id, created_at: now },
        });
        created++;
      }
    }
    return { created, updated };
  }

  // ─── GĐ1: Backfill (cào sâu lịch sử, 1 lần/page) ─────────────────────────

  // Batch đầu SYNCHRONOUS (~20 video) — chỉ fetch + upsert, KHÔNG set is_backfilled/unlock
  // (giữ nguyên is_scraping=true để phần nền tiếp tục), khớp pattern TikTok/Douyin.
  async backfillPageSync(pageId: string, count: number): Promise<{ created: number; updated: number }> {
    const page = await this.prisma.video_management_managedfacebookpage.findUnique({ where: { page_id: pageId } });
    if (!page) throw new Error(`Page ${pageId} không tồn tại`);
    if (!page.page_access_token) throw new Error(`Page ${pageId} chưa có access token`);

    await this.lockPage(page.id);
    const { videos } = await this.aiClient.fetchPageBackfill(pageId, page.page_access_token, count);
    if (videos.length === 0) return { created: 0, updated: 0 };
    return this.upsertVideos(page.id, videos);
  }

  async backfillPage(pageId: string, maxTotal = 300): Promise<{ created: number; updated: number; total_scanned: number }> {
    const page = await this.prisma.video_management_managedfacebookpage.findUnique({ where: { page_id: pageId } });
    if (!page) throw new Error(`Page ${pageId} không tồn tại`);
    if (!page.page_access_token) throw new Error(`Page ${pageId} chưa có access token`);

    await this.lockPage(page.id);
    try {
      const { videos, total_scanned } = await this.aiClient.fetchPageBackfill(pageId, page.page_access_token, maxTotal);

      let created = 0;
      let updated = 0;
      if (videos.length > 0) {
        ({ created, updated } = await this.upsertVideos(page.id, videos));
      }

      await this.prisma.video_management_managedfacebookpage.update({
        where: { id: page.id },
        data: { is_backfilled: true, updated_at: new Date() },
      });
      await this.unlockPage(page.id);

      this.logger.log(`[BACKFILL] ${page.name}: +${created} mới, ~${updated} cập nhật (quét ${total_scanned} bài)`);
      return { created, updated, total_scanned };
    } catch (err: any) {
      await this.unlockPage(page.id, err.message);
      throw err;
    }
  }

  async backfillAllPages(maxTotal = 300): Promise<{ total: number; done: number; failed: number }> {
    await this.resetStaleLocks();

    const pages = await this.prisma.video_management_managedfacebookpage.findMany({
      where: { is_active: true, is_backfilled: false, is_scraping: false },
    });

    if (pages.length === 0) {
      this.logger.log('[BACKFILL] Tất cả pages đã được backfill.');
      return { total: 0, done: 0, failed: 0 };
    }

    this.logger.log(`═══ [BACKFILL] ${pages.length} page(s) cần cào lịch sử ═══`);
    let done = 0;
    let failed = 0;

    for (const page of pages) {
      try {
        await this.backfillPage(page.page_id, maxTotal);
        done++;
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ Backfill ${page.name}: ${err.message}`);
      }
    }

    this.logger.log(`═══ [BACKFILL] Xong: ${done}/${pages.length} OK, ${failed} lỗi ═══`);
    return { total: pages.length, done, failed };
  }

  // ─── GĐ2: Delta sync (cào bài mới) ────────────────────────────────────────

  async syncPage(pageId: string, maxPosts = 10): Promise<{ created: number; updated: number }> {
    const page = await this.prisma.video_management_managedfacebookpage.findUnique({ where: { page_id: pageId } });
    if (!page) throw new Error(`Page ${pageId} không tồn tại`);

    await this.lockPage(page.id);
    try {
      const { page_metadata, videos } = await this.aiClient.fetchPageSync(pageId, page.page_access_token, maxPosts);

      const now = new Date();
      await this.prisma.video_management_managedfacebookpage.update({
        where: { id: page.id },
        data: {
          name: page_metadata.name || page.name,
          username: page_metadata.username || page.username,
          category: page_metadata.category || page.category,
          avatar_url: page_metadata.avatar_url || page.avatar_url,
          followers_count: BigInt(page_metadata.followers_count || 0),
          likes_count: BigInt(page_metadata.likes_count || 0),
          raw_data: page_metadata.raw_data ?? {},
          last_synced_at: now,
          updated_at: now,
        },
      });

      let created = 0;
      let updated = 0;
      if (videos.length > 0) {
        ({ created, updated } = await this.upsertVideos(page.id, videos));
      }

      await this.unlockPage(page.id);
      this.logger.log(`[SYNC] ${page.name}: +${created} mới, ~${updated} cập nhật`);
      return { created, updated };
    } catch (err: any) {
      await this.unlockPage(page.id, err.message);
      throw err;
    }
  }

  async deltaSyncAllPages(): Promise<{ total: number; done: number; failed: number }> {
    await this.resetStaleLocks();

    const pages = await this.prisma.video_management_managedfacebookpage.findMany({
      where: { is_active: true, is_backfilled: true, is_scraping: false },
      orderBy: { last_scraped_at: 'asc' },
    });

    if (pages.length === 0) {
      this.logger.log('[DELTA] Không có page nào cần sync.');
      return { total: 0, done: 0, failed: 0 };
    }

    this.logger.log(`═══ [DELTA] Quét bài mới cho ${pages.length} page(s) ═══`);
    let done = 0;
    let failed = 0;

    for (const page of pages) {
      try {
        await this.syncPage(page.page_id, 10);
        done++;
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ Delta ${page.name}: ${err.message}`);
      }
    }

    this.logger.log(`═══ [DELTA] Xong: ${done}/${pages.length} OK, ${failed} lỗi ═══`);
    return { total: pages.length, done, failed };
  }

  // ─── GĐ3: Refresh metrics (view/like/comment/share video N ngày gần đây) ─

  async refreshRecentMetrics(days = 7): Promise<{ updated: number; total: number }> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const recentVideos = await this.prisma.video_management_ownedvideocontent.findMany({
      where: { published_at: { gte: cutoff }, managed_page: { is_active: true } },
      include: { managed_page: true },
    });

    if (recentVideos.length === 0) {
      this.logger.log(`[METRICS] Không có video nào trong ${days} ngày gần đây`);
      return { updated: 0, total: 0 };
    }

    const pageGroups = new Map<string, { page: (typeof recentVideos)[number]['managed_page']; videos: typeof recentVideos }>();
    for (const v of recentVideos) {
      const key = v.managed_page.page_id;
      if (!pageGroups.has(key)) pageGroups.set(key, { page: v.managed_page, videos: [] as any });
      pageGroups.get(key)!.videos.push(v);
    }

    let totalUpdated = 0;
    for (const { page, videos } of pageGroups.values()) {
      if (!page.page_access_token) {
        this.logger.warn(`⚠️ Page ${page.name} chưa có access token`);
        continue;
      }

      const postIds = videos.map((v) => v.post_id);
      const { metrics } = await this.aiClient.fetchMetricsRefresh(page.page_access_token, postIds);

      for (const v of videos) {
        const m = metrics[v.post_id];
        if (!m) continue;
        await this.prisma.video_management_ownedvideocontent.update({
          where: { id: v.id },
          data: {
            view_count: BigInt(m.view_count ?? Number(v.view_count)),
            like_count: m.like_count ?? v.like_count,
            comment_count: m.comment_count ?? v.comment_count,
            share_count: m.share_count ?? v.share_count,
            updated_at: new Date(),
          },
        });
        totalUpdated++;
      }
      this.logger.log(`📊 [METRICS] ${page.name}: cập nhật ${postIds.length} video`);
    }

    this.logger.log(`✅ [METRICS] Tổng: ${totalUpdated} video cập nhật metrics`);
    return { updated: totalUpdated, total: recentVideos.length };
  }
}
