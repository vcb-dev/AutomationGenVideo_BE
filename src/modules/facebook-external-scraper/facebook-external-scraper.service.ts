import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  FacebookExternalAiClientService,
  ParsedFanpageProfile,
  ParsedFacebookReel,
} from './facebook-external-ai-client.service';
import { cleanFacebookUrl, extractHandleFromUrl } from './facebook-url.util';
import { normalizeTargetCount } from '../../common/utils/target-count.util';
import { DeleteChannelResult, buildDeleteChannelResult } from '../../common/utils/delete-channel.util';

const STALE_LOCK_MINUTES = 30;

// Ghi vào scrape_error khi AI chỉ trả được profile tạm (RapidAPI không phản hồi).
// Kênh vẫn được giữ lại để user không mất công thêm lại, nhưng phải hiện rõ là chưa
// lấy được dữ liệu thật — trước đây trường hợp này báo 'completed' như cào thành công.
const FALLBACK_SCRAPE_ERROR = 'Chưa lấy được dữ liệu từ RapidAPI — đang hiển thị thông tin tạm từ URL';

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
  private async applyFanpageUpdate(
    fanpageId: bigint,
    profile: ParsedFanpageProfile,
    isFallback = false,
  ): Promise<bigint | null> {
    const current = await this.prisma.scraperFanpage.findUnique({ where: { id: fanpageId } });

    // Kênh đã bị xoá giữa chừng. Nút xoá cho bấm bất kể trạng thái, mà scrapeByUrl cào
    // batch đầu đồng bộ rồi còn dispatch tiếp phần nền — người dùng hoàn toàn có thể xoá
    // đúng lúc đó. Ghi tiếp thì Prisma ném "Record to update not found" và họ nhận 500 cho
    // chính thao tác mình vừa chủ động huỷ, nên dừng êm là đúng hơn.
    if (!current) {
      this.logger.warn(`[FB-EXTERNAL] Fanpage ${fanpageId} đã bị xoá giữa lượt cào — bỏ qua phần ghi.`);
      return null;
    }

    // Profile tạm (RapidAPI chết, AI dựng từ URL/cache) chỉ được ĐIỀN VÀO CHỖ TRỐNG.
    // Không đụng profile_id: id tạm 'tmp_<handle>' có thể trùng một bản ghi rác khác
    // và làm nhánh reconcile bên dưới xóa nhầm fanpage thật.
    if (isFallback) {
      const data: any = { is_visible_on_ui: true };
      if (!current.name && profile.name) data.name = profile.name;
      if (!current.handle && profile.handle) data.handle = profile.handle;
      if (!current.avatar_url && profile.avatar_url) data.avatar_url = profile.avatar_url;
      if (current.followers_count <= 0n && profile.followers_count > 0) {
        data.followers_count = BigInt(profile.followers_count);
      }
      const updated = await this.prisma.scraperFanpage.update({ where: { id: fanpageId }, data });
      return updated.id;
    }

    const existingByRealId = await this.prisma.scraperFanpage.findUnique({ where: { profile_id: profile.profile_id } });

    let targetId = fanpageId;
    if (existingByRealId) {
      if (existingByRealId.id !== current.id) {
        await this.prisma.scraperFanpage.delete({ where: { id: current.id } });
      }
      targetId = existingByRealId.id;
    } else {
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
    isFallback = false,
  ): Promise<{ fanpage_id: number | null; created: number; updated: number }> {
    let targetId: bigint | null = fanpageId;

    if (profile || reels.length > 0) {
      targetId = profile ? await this.applyFanpageUpdate(fanpageId, profile, isFallback) : null;
    }

    if (!targetId) {
      return { fanpage_id: null, created: 0, updated: 0 };
    }

    // Dữ liệu tạm thì đừng báo 'completed' — FE đọc scrape_error để biết lượt cào
    // này không thật sự thành công (xem src/lib/scrape/scrape-outcome.ts).
    const finalStatus = isFallback ? 'failed' : 'completed';
    const finalError = isFallback ? FALLBACK_SCRAPE_ERROR : null;

    if (reels.length === 0) {
      await this.prisma.scraperFanpage.update({
        where: { id: targetId },
        data: { last_scraped_at: new Date(), scraping_status: finalStatus, scrape_error: finalError },
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

    const updateData: any = { last_scraped_at: new Date(), scraping_status: finalStatus, scrape_error: finalError };
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
    const effectiveNum = normalizeTargetCount(numOfPosts);

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

    // Không có gì để ghi (kể cả profile tạm) → hard-fail như cũ.
    if (!profileApiOk && !profile) {
      // Profile fail + đây là bản ghi tạm → xóa luôn (khớp code gốc)
      if (isPlaceholder) {
        await this.prisma.scraperFanpage.delete({ where: { id: fanpageId } });
      } else {
        await this.prisma.scraperFanpage.update({
          where: { id: fanpageId },
          data: { scraping_status: 'failed', scrape_error: 'Không lấy được profile detail từ RapidAPI' },
        });
      }
      throw new HttpException({ error: 'Không lấy được thông tin Fanpage từ RapidAPI. Vui lòng kiểm tra lại URL hoặc cấu hình RAPIDAPI_FACEBOOK_KEY.' }, HttpStatus.BAD_REQUEST);
    }

    const isFallback = !profileApiOk;
    if (isFallback) {
      this.logger.warn(`[FB-EXTERNAL] ${fanpage.name}: RapidAPI không trả dữ liệu, dùng profile tạm.`);
    }

    try {
      const result = await this.ingestFetchedData(fanpageId, profile, reels, isFallback);
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
  ): Promise<{ created: number; updated: number; reels_returned: number; fallback_used: boolean }> {
    const isPlaceholder = !fanpage.profile_id || fanpage.profile_id.startsWith('tmp_');

    let fetchResult: { profile_api_ok: boolean; profile: ParsedFanpageProfile | null; reels: ParsedFacebookReel[] };
    try {
      fetchResult = await this.aiClient.fetchPageReels(fanpage.page_url, count, [], '');
    } catch (err: any) {
      if (isPlaceholder) {
        await this.prisma.scraperFanpage.delete({ where: { id: fanpage.id } }).catch(() => {});
      }
      const msg = err.response?.data?.error || err.response?.data?.detail || err.message;
      throw new HttpException({ error: `Lỗi kết nối AI cào Facebook: ${msg}` }, err.response?.status || HttpStatus.BAD_GATEWAY);
    }

    const { profile_api_ok, profile, reels } = fetchResult;

    // Không có gì để ghi (kể cả profile tạm) → hard-fail như cũ.
    if (!profile_api_ok && !profile) {
      if (isPlaceholder) {
        await this.prisma.scraperFanpage.delete({ where: { id: fanpage.id } }).catch(() => {});
      } else {
        await this.prisma.scraperFanpage.update({
          where: { id: fanpage.id },
          data: { scraping_status: 'failed', scrape_error: 'Không lấy được profile detail từ RapidAPI' },
        }).catch(() => {});
      }
      throw new HttpException({ error: 'Không lấy được thông tin Fanpage từ RapidAPI. Vui lòng kiểm tra lại URL hoặc cấu hình RAPIDAPI_FACEBOOK_KEY.' }, HttpStatus.BAD_REQUEST);
    }

    const result = await this.ingestFetchedData(fanpage.id, profile, reels, !profile_api_ok);
    return {
      created: result.created,
      updated: result.updated,
      reels_returned: reels.length,
      fallback_used: !profile_api_ok,
    };
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
        const reason = result.fallback_used
          ? FALLBACK_SCRAPE_ERROR
          : 'Không tìm thấy reels cho page này';
        throw new HttpException({ error: reason }, HttpStatus.NOT_FOUND);
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
      await this.prisma.scraperFanpage.update({
        where: { id: fp.id },
        data: { scraping_status: 'idle', last_scraped_at: new Date() },
      }).catch(() => {});
      return {
        status: 'ok',
        message: result.fallback_used
          ? `Đã thêm kênh ${fp.name || handle} nhưng ${FALLBACK_SCRAPE_ERROR.toLowerCase()}. Thử cào lại sau.`
          : `Đã thêm kênh ${fp.name || handle} thành công. (Chưa tìm thấy reels hoặc cần cấu hình RAPIDAPI_FACEBOOK_KEY để cào video).`,
        fanpage_id: Number(fp.id),
      };
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

  // ─── Xoá cứng fanpage ───────────────────────────────────────────────────────

  // Reels/metrics/keywords đều gắn khoá ngoại onDelete Cascade nên Postgres tự dọn.
  // Phải ĐẾM TRƯỚC khi xoá: đếm sau thì cascade đã quét sạch, con số báo về luôn là 0.
  async deleteFanpage(id: bigint): Promise<DeleteChannelResult> {
    const fp = await this.prisma.scraperFanpage.findUnique({ where: { id } });
    if (!fp) throw new HttpException({ error: 'Không tìm thấy fanpage' }, HttpStatus.NOT_FOUND);

    const videosDeleted = await this.prisma.scraperFacebookReel.count({ where: { fanpage_id: id } });
    await this.prisma.scraperFanpage.delete({ where: { id } });

    this.logger.warn(`[FB-EXTERNAL] Đã xoá cứng fanpage "${fp.name}" (id=${id}) kèm ${videosDeleted} reels.`);
    return buildDeleteChannelResult(id, fp.name, videosDeleted);
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

      const { profile_api_ok, profile, reels } = await this.aiClient.fetchPageReels(fanpage.page_url, 10, existingIds, startDate);

      const result = await this.ingestFetchedData(fanpageId, profile, reels, !profile_api_ok);
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
  /** Cron định kỳ: chỉ làm mới fanpage đã bật cào định kỳ. */
  async periodicRefresh(): Promise<{ total: number; done: number; failed: number }> {
    return this.refreshPages(true);
  }

  /**
   * Nút "Đồng bộ tất cả" trên UI: làm mới MỌI fanpage, không cần bật cào định kỳ.
   *
   * Facebook đi qua RapidAPI với quota rất hẹp (~400 lượt còn lại), nên khoá không cho chạy
   * hai lượt song song — nhấp đúp là đốt quota gấp đôi mà không được thêm dữ liệu nào.
   */
  async syncAllPages(): Promise<{ total: number; done: number; failed: number; already_running?: boolean }> {
    if (this.syncAllRunning) {
      return { total: 0, done: 0, failed: 0, already_running: true };
    }
    this.syncAllRunning = true;
    try {
      return await this.refreshPages(false);
    } finally {
      this.syncAllRunning = false;
    }
  }

  private syncAllRunning = false;

  /** Controller hỏi trước khi dispatch, để trả lời ngay thay vì chờ hết lượt cào. */
  isSyncAllRunning(): boolean {
    return this.syncAllRunning;
  }

  private async refreshPages(periodicOnly: boolean): Promise<{ total: number; done: number; failed: number }> {
    await this.resetStaleLocks();

    const pages = await this.prisma.scraperFanpage.findMany({
      where: {
        // Cron chỉ đụng fanpage đã cào lần đầu (cào lần đầu tốn nhiều lượt RapidAPI hơn
        // hẳn, mà quota chỉ còn ~400). Nút "Đồng bộ tất cả" có người bấm và đã xác nhận
        // nên với tới được cả fanpage chưa cào.
        ...(periodicOnly ? { is_periodic_crawl: true, is_initial_scraped: true } : {}),
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
