import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  FacebookExternalAiClientService,
  ParsedFanpageProfile,
  ParsedFacebookReel,
} from './facebook-external-ai-client.service';
import { cleanFacebookUrl, extractHandleFromUrl } from './facebook-url.util';

const STALE_LOCK_MINUTES = 30;

// Toàn bộ logic ghi DB port từ AI (rapidapi_facebook.py::_upsert_fanpage/ingest_reels_data/
// save_profile_to_db đã xóa + scraper_views.py::fanpage_toggle/trigger_scrape_reels/
// fanpage_scrape_by_url + tasks.py::scrape_reels_for_page_task/periodic_scrape_marked_pages_task).
// AI giờ chỉ fetch + parse (facebook_external_fetch_views.py), BE là nơi duy nhất ghi
// scraper_fanpages / scraper_facebook_reels / scraper_fanpage_metrics_history.
@Injectable()
export class FacebookExternalScraperService {
  private readonly logger = new Logger(FacebookExternalScraperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: FacebookExternalAiClientService,
  ) {}

  private async upsertReel(fanpageId: bigint, r: ParsedFacebookReel): Promise<{ created: boolean }> {
    const existing = await this.prisma.scraperFacebookReel.findUnique({ where: { post_id: r.post_id } });
    const data = {
      fanpage_id: fanpageId,
      shortcode: r.shortcode,
      url: r.url,
      content: r.content,
      hashtags: r.hashtags,
      video_url: r.video_url,
      thumbnail_url: r.thumbnail_url,
      duration_seconds: r.duration_seconds,
      has_audio: r.has_audio,
      date_posted: new Date(r.date_posted),
      views_count: BigInt(r.views_count || 0),
      likes_count: BigInt(r.likes_count || 0),
      comments_count: BigInt(r.comments_count || 0),
      shares_count: BigInt(r.shares_count || 0),
    };

    if (existing) {
      await this.prisma.scraperFacebookReel.update({ where: { post_id: r.post_id }, data });
      return { created: false };
    }
    await this.prisma.scraperFacebookReel.create({ data: { ...data, post_id: r.post_id } });
    return { created: true };
  }

  // Khớp _upsert_fanpage cũ: nếu profile_id thật đã tồn tại ở 1 fanpage khác (placeholder
  // "graduate" thành trùng với page đã có) → xóa fanpage hiện tại (placeholder), dùng page
  // thật. Nếu chưa tồn tại và fanpage hiện tại là placeholder → ghi đè profile_id thật vào.
  // Field name/url/handle/avatar_url/is_verified/followers_count chỉ ghi đè khi có giá trị.
  private async applyFanpageUpdate(fanpageId: bigint, profile: ParsedFanpageProfile): Promise<bigint> {
    const current = await this.prisma.scraperFanpage.findUnique({ where: { id: fanpageId } });
    const existingByRealId = await this.prisma.scraperFanpage.findUnique({ where: { profile_id: profile.profile_id } });

    let targetId = fanpageId;
    if (existingByRealId) {
      if (current && existingByRealId.id !== current.id) {
        await this.prisma.scraperFanpage.delete({ where: { id: current.id } });
      }
      targetId = existingByRealId.id;
    } else if (current) {
      const isPlaceholder = !current.profile_id || current.profile_id.startsWith('tmp_');
      if (isPlaceholder) {
        await this.prisma.scraperFanpage.update({ where: { id: current.id }, data: { profile_id: profile.profile_id } });
      }
    }

    const data: any = { is_visible_on_ui: true };
    if (profile.name) data.name = profile.name;
    if (profile.page_url) data.page_url = profile.page_url;
    if (profile.handle) data.handle = profile.handle;
    if (profile.avatar_url) data.avatar_url = profile.avatar_url;
    if (profile.is_verified !== null && profile.is_verified !== undefined) data.is_verified = profile.is_verified;
    if (profile.followers_count > 0) data.followers_count = BigInt(profile.followers_count);

    const updated = await this.prisma.scraperFanpage.update({ where: { id: targetId }, data });
    return updated.id;
  }

  // Khớp ingest_reels_data cũ. profile=null khi không resolve được profile_id nào
  // (kể cả fallback từ author trong reel) — bail, không cào được gì.
  private async ingestFetchedData(
    fanpageId: bigint,
    profile: ParsedFanpageProfile | null,
    reels: ParsedFacebookReel[],
  ): Promise<{ fanpage_id: number | null; created: number; updated: number }> {
    let targetId: bigint | null = fanpageId;

    if (profile || reels.length > 0) {
      targetId = profile ? await this.applyFanpageUpdate(fanpageId, profile) : null;
    }

    if (!targetId) {
      return { fanpage_id: null, created: 0, updated: 0 };
    }

    if (reels.length === 0) {
      await this.prisma.scraperFanpage.update({
        where: { id: targetId },
        data: { last_scraped_at: new Date(), scraping_status: 'completed', scrape_error: null },
      });
      return { fanpage_id: Number(targetId), created: 0, updated: 0 };
    }

    const fp = await this.prisma.scraperFanpage.findUniqueOrThrow({ where: { id: targetId } });
    await this.prisma.scraperFanpageMetrics.create({
      data: { fanpage_id: targetId, followers_count: fp.followers_count, likes_count: fp.likes_count },
    });

    let created = 0;
    let updated = 0;
    for (const r of reels) {
      const result = await this.upsertReel(targetId, r);
      if (result.created) created++;
      else updated++;
    }

    const updateData: any = { last_scraped_at: new Date(), scraping_status: 'completed', scrape_error: null };
    if (!fp.is_initial_scraped && created > 0) updateData.is_initial_scraped = true;
    await this.prisma.scraperFanpage.update({ where: { id: targetId }, data: updateData });

    return { fanpage_id: Number(targetId), created, updated };
  }

  // ─── Manual trigger (scrape-reels / scrape-by-url) — hard-fail nếu raw profile
  // API call thất bại, khớp scrape_reels_for_page_task cũ (khác periodic, xem dưới). ──

  async scrapeReels(fanpageId: bigint, numOfPosts: number): Promise<{ fanpage_id: number | null; created: number; updated: number }> {
    const fanpage = await this.prisma.scraperFanpage.findUnique({ where: { id: fanpageId } });
    if (!fanpage) throw new Error(`Fanpage ${fanpageId} không tồn tại`);

    await this.prisma.scraperFanpage.update({ where: { id: fanpageId }, data: { scraping_status: 'processing' } });

    const isPlaceholder = !fanpage.profile_id || fanpage.profile_id.startsWith('tmp_');

    const existingRows = await this.prisma.scraperFacebookReel.findMany({
      where: { fanpage_id: fanpageId },
      orderBy: { date_posted: 'desc' },
      take: 500,
      select: { post_id: true },
    });
    const existingIds = existingRows.map((r) => r.post_id);

    let startDate = '';
    if (fanpage.is_initial_scraped && fanpage.last_scraped_at) {
      startDate = fanpage.last_scraped_at.toISOString().slice(0, 10);
    }
    const effectiveNum = fanpage.is_initial_scraped ? numOfPosts : 300;

    let profileApiOk: boolean;
    let profile: ParsedFanpageProfile | null;
    let reels: ParsedFacebookReel[];
    try {
      const result = await this.aiClient.fetchPageReels(fanpage.page_url, effectiveNum, existingIds, startDate);
      profileApiOk = result.profile_api_ok;
      profile = result.profile;
      reels = result.reels;
    } catch (err: any) {
      await this.prisma.scraperFanpage.update({
        where: { id: fanpageId },
        data: { scraping_status: 'failed', scrape_error: (err.message || '').slice(0, 500) },
      });
      throw err;
    }

    if (!profileApiOk) {
      // Profile fail + đây là bản ghi tạm → xóa luôn (khớp code gốc)
      if (isPlaceholder) {
        await this.prisma.scraperFanpage.delete({ where: { id: fanpageId } });
      } else {
        await this.prisma.scraperFanpage.update({
          where: { id: fanpageId },
          data: { scraping_status: 'failed', scrape_error: 'Không lấy được profile detail từ API' },
        });
      }
      throw new Error('Không lấy được profile detail từ API');
    }

    try {
      const result = await this.ingestFetchedData(fanpageId, profile, reels);
      this.logger.log(`[FB-EXTERNAL] ${fanpage.name}: +${result.created} mới, ~${result.updated} cập nhật`);
      return result;
    } catch (err: any) {
      await this.prisma.scraperFanpage.update({
        where: { id: fanpageId },
        data: { scraping_status: 'failed', scrape_error: (err.message || '').slice(0, 500) },
      });
      throw err;
    }
  }

  // Batch đầu SYNCHRONOUS (~20 reels) — chỉ fetch + ingest, KHÔNG chuyển scraping_status
  // sang trạng thái cuối (giữ 'processing' để phần nền tiếp tục), khớp pattern TikTok/Douyin.
  // Vẫn hard-fail + xóa placeholder nếu profile API thất bại (khớp scrapeReels ở trên).
  private async ingestReelsSyncFirst(
    fanpage: { id: bigint; page_url: string; profile_id: string },
    count: number,
  ): Promise<{ created: number; updated: number; reels_returned: number }> {
    const isPlaceholder = !fanpage.profile_id || fanpage.profile_id.startsWith('tmp_');

    const { profile_api_ok, profile, reels } = await this.aiClient.fetchPageReels(fanpage.page_url, count, [], '');

    if (!profile_api_ok) {
      if (isPlaceholder) {
        await this.prisma.scraperFanpage.delete({ where: { id: fanpage.id } });
      } else {
        await this.prisma.scraperFanpage.update({
          where: { id: fanpage.id },
          data: { scraping_status: 'failed', scrape_error: 'Không lấy được profile detail từ API' },
        });
      }
      throw new Error('Không lấy được profile detail từ API');
    }

    const result = await this.ingestFetchedData(fanpage.id, profile, reels);
    return { created: result.created, updated: result.updated, reels_returned: reels.length };
  }

  async triggerScrapeReels(fanpageId: bigint): Promise<any> {
    const fp = await this.prisma.scraperFanpage.findUnique({ where: { id: fanpageId } });
    if (!fp) throw new HttpException({ error: `Fanpage ${fanpageId} not found` }, HttpStatus.NOT_FOUND);

    if (fp.scraping_status === 'processing') {
      return { status: 'ok', message: `${fp.name} đang được cào.`, is_scraping: true };
    }

    if (!fp.is_initial_scraped) {
      await this.prisma.scraperFanpage.update({
        where: { id: fanpageId },
        data: { scraping_status: 'processing', scrape_error: null },
      });

      // Batch đầu SYNCHRONOUS (~20 reels, rất nhanh) — trả data ngay cho user
      const result = await this.ingestReelsSyncFirst(fp, 20);
      if (result.reels_returned === 0) {
        throw new HttpException({ error: 'Không tìm thấy reels cho page này' }, HttpStatus.NOT_FOUND);
      }

      // Dispatch cào tiếp tới tổng 300 reels (fire-and-forget)
      this.scrapeReels(fanpageId, 300).catch((err) => {
        this.logger.error(`[FB-EXTERNAL] trigger-scrape ${fanpageId} continuation thất bại: ${err.message}`);
      });

      return {
        status: 'ok',
        message: `Đã cào ${result.created} reels đầu cho ${fp.name}. Đang tiếp tục cào thêm...`,
      };
    }

    // Đã cào lần đầu rồi → chỉ cào delta (10), fully async như cũ
    const num = 10;
    this.scrapeReels(fanpageId, num).catch((err) => {
      this.logger.error(`[FB-EXTERNAL] trigger-scrape ${fanpageId} thất bại: ${err.message}`);
    });

    return { status: 'ok', message: `Đã gửi yêu cầu cào ${num} reels cho ${fp.name}.` };
  }

  async scrapeByUrl(url: string): Promise<any> {
    const cleanUrl = cleanFacebookUrl(url);
    const handle = extractHandleFromUrl(cleanUrl);

    if (!handle && !cleanUrl.includes('profile.php')) {
      throw new HttpException({ error: 'Không thể trích xuất tên page từ URL.' }, HttpStatus.BAD_REQUEST);
    }

    let fp = handle ? await this.prisma.scraperFanpage.findFirst({ where: { handle } }) : null;
    if (!fp) {
      fp = await this.prisma.scraperFanpage.findFirst({ where: { page_url: cleanUrl } });
    }

    if (fp) {
      if (fp.scraping_status === 'processing') {
        return {
          status: 'ok',
          message: `${fp.name || handle} đang được cào.`,
          is_scraping: true,
          fanpage_id: Number(fp.id),
        };
      }
      if (fp.is_initial_scraped) {
        return {
          status: 'ok',
          message: `${fp.name || handle} đã có trong hệ thống.`,
          already_exists: true,
          fanpage_id: Number(fp.id),
        };
      }
    } else {
      // Temp profile_id dựa trên handle để tránh unique conflict (profile_id thật sẽ
      // ghi đè khi task cào xong). Fallback ngẫu nhiên cho URL dạng profile.php (không có handle).
      const tempId = handle ? `tmp_${handle}` : `tmp_${Date.now()}${Math.floor(Math.random() * 1e6)}`;
      fp = await this.prisma.scraperFanpage.create({
        data: {
          profile_id: tempId,
          name: handle || 'Facebook Page',
          handle: handle || '',
          page_url: cleanUrl,
          is_visible_on_ui: true,
        },
      });
    }

    await this.prisma.scraperFanpage.update({
      where: { id: fp.id },
      data: { scraping_status: 'processing', scrape_error: null },
    });

    // fp.is_initial_scraped luôn là false ở đây (nhánh true đã return sớm ở trên,
    // fanpage mới tạo mặc định false) — luôn là lần cào đầu.
    // Batch đầu SYNCHRONOUS (~20 reels, rất nhanh) — trả data ngay cho user
    const result = await this.ingestReelsSyncFirst(fp, 20);
    if (result.reels_returned === 0) {
      throw new HttpException({ error: 'Không tìm thấy reels cho page này' }, HttpStatus.NOT_FOUND);
    }

    // Dispatch cào tiếp tới tổng 300 reels (fire-and-forget)
    this.scrapeReels(fp.id, 300).catch((err) => {
      this.logger.error(`[FB-EXTERNAL] scrape-by-url ${url} continuation thất bại: ${err.message}`);
    });

    return {
      status: 'ok',
      message: `Đã cào ${result.created} reels đầu cho ${fp.name || handle}. Đang tiếp tục cào thêm...`,
      fanpage_id: Number(fp.id),
    };
  }

  // ─── Toggle bookmark/periodic_crawl ─────────────────────────────────────────

  async toggleFanpage(id: bigint, field: 'is_bookmarked' | 'is_periodic_crawl'): Promise<any> {
    const fp = await this.prisma.scraperFanpage.findUnique({ where: { id } });
    if (!fp) throw new HttpException({ error: 'Not found' }, HttpStatus.NOT_FOUND);
    const newValue = !fp[field];
    await this.prisma.scraperFanpage.update({ where: { id }, data: { [field]: newValue } });
    return { id: Number(id), [field]: newValue };
  }

  // Tự mở khóa fanpage bị kẹt ở 'processing' quá lâu (worker crash giữa chừng).
  private async resetStaleLocks(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000);
    const result = await this.prisma.scraperFanpage.updateMany({
      where: { scraping_status: 'processing', updated_at: { lt: cutoff } },
      data: { scraping_status: 'idle' },
    });
    if (result.count > 0) {
      this.logger.warn(`⚠️ Reset ${result.count} fanpage bị stuck lock`);
    }
  }

  // ─── Periodic (cron): lenient — không hard-fail nếu profile API thất bại,
  // luôn ingest bất kể profile_api_ok (khớp scrape_reels_sync/periodic task cũ). ────

  private async periodicScrapeOne(fanpageId: bigint): Promise<{ created: number; updated: number }> {
    const fanpage = await this.prisma.scraperFanpage.findUniqueOrThrow({ where: { id: fanpageId } });

    await this.prisma.scraperFanpage.update({ where: { id: fanpageId }, data: { scraping_status: 'processing' } });

    try {
      const existingRows = await this.prisma.scraperFacebookReel.findMany({
        where: { fanpage_id: fanpageId },
        orderBy: { date_posted: 'desc' },
        take: 500,
        select: { post_id: true },
      });
      const existingIds = existingRows.map((r) => r.post_id);

      const startDate = fanpage.last_scraped_at
        ? fanpage.last_scraped_at.toISOString().slice(0, 10)
        : new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

      const { profile, reels } = await this.aiClient.fetchPageReels(fanpage.page_url, 10, existingIds, startDate);

      const result = await this.ingestFetchedData(fanpageId, profile, reels);
      return { created: result.created, updated: result.updated };
    } catch (err: any) {
      await this.prisma.scraperFanpage.update({
        where: { id: fanpageId },
        data: { scraping_status: 'failed', scrape_error: (err.message || '').slice(0, 500) },
      });
      throw err;
    }
  }

  // is_periodic_crawl là tiêu chí chọn lọc duy nhất; scraping_status chỉ dùng để loại trừ
  // fanpage đang cào dở (!= 'processing'), không so khớp cứng 1 giá trị cụ thể.
  async periodicRefresh(): Promise<{ total: number; done: number; failed: number }> {
    await this.resetStaleLocks();

    const pages = await this.prisma.scraperFanpage.findMany({
      where: {
        is_periodic_crawl: true,
        is_initial_scraped: true,
        is_visible_on_ui: true,
        scraping_status: { not: 'processing' },
      },
      orderBy: { last_scraped_at: 'asc' },
    });

    if (pages.length === 0) {
      this.logger.log('[FB-EXTERNAL-PERIODIC] Không có page nào cần cào định kỳ.');
      return { total: 0, done: 0, failed: 0 };
    }

    this.logger.log(`═══ [FB-EXTERNAL-PERIODIC] Cào reels mới cho ${pages.length} page(s) đánh dấu ═══`);
    let done = 0;
    let failed = 0;

    for (const fp of pages) {
      try {
        const result = await this.periodicScrapeOne(fp.id);
        done++;
        this.logger.log(`  ✅ ${fp.name}: +${result.created} mới`);
      } catch (err: any) {
        failed++;
        this.logger.error(`  ❌ ${fp.name}: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    this.logger.log(`═══ [FB-EXTERNAL-PERIODIC] Xong: ${done}/${pages.length} OK, ${failed} lỗi ═══`);
    return { total: pages.length, done, failed };
  }
}
