import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../task-auto/notifications/notifications.service';
import { DEFAULT_TARGET_COUNT } from '../../common/utils/target-count.util';
import { readAiServiceError } from '../../common/utils/ai-service-error.util';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';
import {
  BilibiliAiClientService, ParsedBilibiliProfile, ParsedBilibiliVideo, ParsedBilibiliSearchVideo,
} from './bilibili-ai-client.service';
import { BilibiliScraperReadService } from './bilibili-scraper-read.service';

const STALE_LOCK_MINUTES = 30;

// Nền tảng mới — chỉ có kênh ngoài (external), không có is_owned. BE sở hữu DB
// hoàn toàn từ đầu (không có code AI cũ để migrate). AI chỉ fetch + parse
// (bilibili_fetch_views.py), BE là nơi duy nhất ghi scraper_bilibili_profiles /
// scraper_bilibili_videos / scraper_bilibili_search_videos. Mirror pattern
// Kuaishou (sync 20 trả ngay + cào nền tới 300, is_tracked-based periodic,
// resetStaleLocks) — mid là ID duy nhất, không có vấn đề 2 không gian ID.
@Injectable()
export class BilibiliScraperService {
  private readonly logger = new Logger(BilibiliScraperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: BilibiliAiClientService,
    private readonly notifications: NotificationsService,
    private readonly readService: BilibiliScraperReadService,
    private readonly aiIntegration: AiIntegrationService,
  ) {}

  // ─── Growth Alert: snapshot followers + báo động nếu tăng đột biến ────────
  private static readonly GROWTH_ALERT_THRESHOLD_PCT = 0.2;

  private async recordMetricsAndMaybeAlert(profileId: bigint, profileName: string): Promise<void> {
    const fresh = await this.prisma.scraperBilibiliProfile.findUniqueOrThrow({ where: { id: profileId } });
    const previous = await this.prisma.scraperBilibiliProfileMetrics.findFirst({
      where: { profile_id: profileId },
      orderBy: { captured_at: 'desc' },
    });

    await this.prisma.scraperBilibiliProfileMetrics.create({
      data: {
        profile_id: profileId,
        followers_count: fresh.followers_count,
        following_count: fresh.following_count,
        likes_count: fresh.likes_count,
      },
    });

    if (!previous || previous.followers_count <= 0n) return;
    const growth = Number(fresh.followers_count - previous.followers_count) / Number(previous.followers_count);
    if (growth < BilibiliScraperService.GROWTH_ALERT_THRESHOLD_PCT) return;

    const pct = Math.round(growth * 100);
    await this.notifications.broadcastToActiveUsers(
      'GROWTH_ALERT',
      `Kênh Bilibili ${profileName} tăng trưởng đột biến`,
      `Followers tăng ${pct}% (${previous.followers_count} → ${fresh.followers_count}) kể từ lần cào trước.`,
      { platform: 'bilibili', profile_id: Number(profileId) },
    );
  }

  // ─── Keyword search ────────────────────────────────────────────────────────

  private async upsertSearchVideo(
    v: ParsedBilibiliSearchVideo,
    keywordOverride?: string,
  ): Promise<{ created: boolean }> {
    const existing = await this.prisma.scraperBilibiliSearchVideo.findUnique({ where: { post_id: v.post_id } });
    // keywordOverride (tiếng Việt user gõ) ưu tiên hơn v.search_keyword (tiếng Trung đã query),
    // để bộ lọc/gợi ý hiển thị chữ dễ đọc.
    const search_keyword = existing?.search_keyword || keywordOverride || v.search_keyword || '';

    const data = {
      url: v.url,
      description: v.description,
      hashtags: v.hashtags,
      thumbnail_url: v.thumbnail_url,
      video_duration: v.video_duration,
      author_id: v.author_id,
      author_username: v.author_username,
      author_avatar: v.author_avatar,
      view_count: BigInt(v.view_count || 0),
      like_count: BigInt(v.like_count || 0),
      comment_count: BigInt(v.comment_count || 0),
      collect_count: BigInt(v.collect_count || 0),
      danmaku_count: BigInt(v.danmaku_count || 0),
      search_keyword,
      date_posted: new Date(v.date_posted),
    };

    if (existing) {
      await this.prisma.scraperBilibiliSearchVideo.update({ where: { post_id: v.post_id }, data });
      return { created: false };
    }
    await this.prisma.scraperBilibiliSearchVideo.create({ data: { ...data, post_id: v.post_id } });
    return { created: true };
  }

  // Dedup (post_id đã có trong DB) làm giảm số video MỚI thực sự ingest được so
  // với `count` yêu cầu — vòng lặp dưới đây gọi tiếp AI với cursor nối tiếp
  // (không lặp lại từ đầu) để bù phần bị trùng, tối đa MAX_SEARCH_ROUNDS lần.
  private static readonly MAX_SEARCH_ROUNDS = 5;

  // ─── Auto-discover kênh mới từ tác giả xuất hiện trong kết quả search ──────
  // Bilibili không có follower count trong search-video, dùng view_count làm
  // ranking signal thay thế. author_id ở đây chính là mid (số), khớp trực
  // tiếp với input của scrapeProfile(mid).
  private static readonly MAX_AUTO_DISCOVER_PER_SEARCH = 5;
  private static readonly MIN_AUTO_DISCOVER_VIEWS = 10000;

  private async autoDiscoverNewAuthors(candidates: Map<string, number>): Promise<string[]> {
    const ranked = Array.from(candidates.entries())
      .filter(([, views]) => views >= BilibiliScraperService.MIN_AUTO_DISCOVER_VIEWS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, BilibiliScraperService.MAX_AUTO_DISCOVER_PER_SEARCH)
      .map(([mid]) => mid);

    if (ranked.length === 0) return [];

    const existing = await this.prisma.scraperBilibiliProfile.findMany({
      where: { mid: { in: ranked } },
      select: { mid: true },
    });
    const existingSet = new Set(existing.map((p) => p.mid));
    const newMids = ranked.filter((mid) => !existingSet.has(mid));

    for (const mid of newMids) {
      this.scrapeProfile(mid).catch((err) => {
        this.logger.error(`[BILIBILI-AUTO-DISCOVER] ${mid} thất bại: ${err.message}`);
      });
    }

    if (newMids.length > 0) {
      this.logger.log(`[BILIBILI-AUTO-DISCOVER] Phát hiện + dispatch cào ${newMids.length} kênh mới: ${newMids.join(', ')}`);
    }
    return newMids;
  }

  /**
   * @param keyword       Từ khoá GỬI ĐI để query (tiếng Trung với nền tảng TQ).
   * @param displayKeyword Từ khoá LƯU vào DB để hiển thị (tiếng Việt user gõ). Bỏ trống = dùng `keyword`.
   */
  async searchKeyword(
    keyword: string,
    count = 30,
    displayKeyword?: string,
  ): Promise<{ created: number; updated: number; auto_discovered: string[] }> {
    let created = 0;
    let updated = 0;
    let cursor: number | null | undefined = undefined;
    let hasMore = true;
    const authorCandidates = new Map<string, number>();
    const storedKeyword = (displayKeyword || '').trim() || undefined;

    for (let round = 0; round < BilibiliScraperService.MAX_SEARCH_ROUNDS && created < count && hasMore; round++) {
      const remaining = count - created;
      const { videos, cursor: nextCursor, has_more } = await this.aiClient.fetchSearch(keyword, remaining, cursor);
      if (videos.length === 0) break;

      for (const v of videos) {
        const r = await this.upsertSearchVideo(v, storedKeyword);
        if (r.created) created++;
        else updated++;

        if (v.author_id) {
          const prevMax = authorCandidates.get(v.author_id) ?? 0;
          authorCandidates.set(v.author_id, Math.max(prevMax, v.view_count ?? 0));
        }
      }

      cursor = nextCursor;
      hasMore = has_more;
    }

    this.logger.log(`[BILIBILI-SEARCH] Ingest '${keyword}'${storedKeyword ? ` (lưu '${storedKeyword}')` : ''}: +${created} new, ~${updated} updated`);

    const auto_discovered = await this.autoDiscoverNewAuthors(authorCandidates);
    return { created, updated, auto_discovered };
  }

  // ─── Profile: helpers ──────────────────────────────────────────────────────

  private async upsertVideo(profileId: bigint, v: ParsedBilibiliVideo): Promise<{ created: boolean }> {
    const existing = await this.prisma.scraperBilibiliVideo.findUnique({ where: { post_id: v.post_id } });
    const data = {
      profile_id: profileId,
      url: v.url,
      description: v.description,
      thumbnail_url: v.thumbnail_url,
      video_duration: v.video_duration,
      view_count: BigInt(v.view_count || 0),
      danmaku_count: BigInt(v.danmaku_count || 0),
      date_posted: new Date(v.date_posted),
    };

    if (existing) {
      await this.prisma.scraperBilibiliVideo.update({ where: { post_id: v.post_id }, data });
      return { created: false };
    }
    await this.prisma.scraperBilibiliVideo.create({ data: { ...data, post_id: v.post_id } });
    return { created: true };
  }

  // Ghi đè toàn bộ field không điều kiện — fetch_user_info luôn trả full info mới nhất.
  private async applyProfileUpdate(profileId: bigint, profile: ParsedBilibiliProfile): Promise<void> {
    await this.prisma.scraperBilibiliProfile.update({
      where: { id: profileId },
      data: {
        username: profile.username,
        nickname: profile.nickname,
        url: profile.url,
        avatar_url: profile.avatar_url,
        biography: profile.biography,
        is_verified: profile.is_verified,
        verify_desc: profile.verify_desc,
        followers_count: BigInt(profile.followers_count || 0),
        following_count: BigInt(profile.following_count || 0),
        likes_count: BigInt(profile.likes_count || 0),
        videos_count: profile.videos_count,
      },
    });
  }

  // Batch đầu SYNCHRONOUS (~20 video) — chỉ fetch + upsert, KHÔNG đổi
  // scraping_status (giữ nguyên 'processing' để phần nền tiếp tục).
  private async ingestVideosSync(
    profile: { id: bigint; mid: string },
    count: number,
  ): Promise<{ created: number; updated: number; items_returned: number }> {
    const { profile_api_ok, profile: parsedProfile, videos } = await this.aiClient.fetchProfile(profile.mid, count);

    if (!profile_api_ok) {
      throw new Error('Không lấy được thông tin profile từ API');
    }
    if (videos.length === 0) return { created: 0, updated: 0, items_returned: 0 };

    if (parsedProfile) await this.applyProfileUpdate(profile.id, parsedProfile);

    let created = 0;
    let updated = 0;
    for (const v of videos) {
      const r = await this.upsertVideo(profile.id, v);
      if (r.created) created++;
      else updated++;
    }
    return { created, updated, items_returned: videos.length };
  }

  // Task đầy đủ — quản lý scraping_status lifecycle (processing → completed/idle/failed).
  // Dùng cho: cào tiếp nền (count=300), delta scrape, cron định kỳ.
  async scrapeProfileVideos(
    profileId: bigint,
    numOfPosts: number,
  ): Promise<{ created: number; updated: number; items_returned: number }> {
    const profile = await this.prisma.scraperBilibiliProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new Error(`Profile ${profileId} không tồn tại`);

    if (profile.scraping_status !== 'processing') {
      await this.prisma.scraperBilibiliProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'processing', scrape_error: null },
      });
    }

    try {
      const { profile_api_ok, profile: parsedProfile, videos } = await this.aiClient.fetchProfile(profile.mid, numOfPosts);

      if (!profile_api_ok) {
        await this.prisma.scraperBilibiliProfile.update({
          where: { id: profileId },
          data: { scraping_status: 'failed', scrape_error: 'Không lấy được thông tin profile từ API' },
        });
        throw new Error('Không lấy được thông tin profile từ API');
      }

      if (videos.length === 0) {
        await this.prisma.scraperBilibiliProfile.update({
          where: { id: profileId },
          data: { scraping_status: 'idle', scrape_error: 'Không có video nào được trả về' },
        });
        return { created: 0, updated: 0, items_returned: 0 };
      }

      if (parsedProfile) await this.applyProfileUpdate(profileId, parsedProfile);

      if (!profile.is_initial_scraped) {
        await this.prisma.scraperBilibiliProfile.update({ where: { id: profileId }, data: { is_initial_scraped: true } });
      }

      let created = 0;
      let updated = 0;
      for (const v of videos) {
        const r = await this.upsertVideo(profileId, v);
        if (r.created) created++;
        else updated++;
      }

      await this.prisma.scraperBilibiliProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'completed', scrape_error: null, last_scraped_at: new Date() },
      });

      const profileLabel = profile.nickname || profile.mid;
      this.recordMetricsAndMaybeAlert(profileId, profileLabel).catch((err) => {
        this.logger.error(`[BILIBILI-GROWTH-ALERT] ${profileLabel}: ${err.message}`);
      });

      this.logger.log(`[BILIBILI-PROFILE] ${profile.nickname || profile.mid}: +${created} mới, ~${updated} cập nhật`);
      return { created, updated, items_returned: videos.length };
    } catch (err: any) {
      await this.prisma.scraperBilibiliProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'failed', scrape_error: (err.message || '').slice(0, 500) },
      });
      throw err;
    }
  }

  async scrapeProfile(mid: string, targetCount = DEFAULT_TARGET_COUNT): Promise<any> {
    let profile = await this.prisma.scraperBilibiliProfile.findUnique({ where: { mid } });
    const wasCreated = !profile;
    if (!profile) {
      profile = await this.prisma.scraperBilibiliProfile.create({
        data: { mid, url: `https://space.bilibili.com/${mid}` },
      });
    }

    if (profile.scraping_status === 'processing') {
      return {
        status: 'ok',
        message: `${profile.nickname || mid} đang được cào.`,
        is_scraping: true,
        profile_id: Number(profile.id),
      };
    }

    const needsDeltaScrape = !wasCreated && profile.is_initial_scraped;
    await this.prisma.scraperBilibiliProfile.update({
      where: { id: profile.id },
      data: { scraping_status: 'processing', scrape_error: null },
    });

    if (needsDeltaScrape) {
      // Delta: kênh đã cào rồi, lấy thêm tới targetCount video mới nhất, fully async
      this.scrapeProfileVideos(profile.id, targetCount).catch((err) => {
        this.logger.error(`[BILIBILI-PROFILE] ${mid} thất bại: ${err.message}`);
      });
      return {
        status: 'ok',
        message: `Đang cập nhật tới ${targetCount} video mới nhất cho kênh ${profile.nickname || mid}...`,
        already_exists: true,
        profile_id: Number(profile.id),
      };
    }

    // Batch đầu SYNCHRONOUS (nhỏ, rất nhanh) — trả data ngay cho user, phần còn lại chạy nền
    const firstBatch = Math.min(20, targetCount);
    const freshProfile = await this.prisma.scraperBilibiliProfile.findUniqueOrThrow({ where: { id: profile.id } });
    let result: { created: number; updated: number; items_returned: number };
    try {
      result = await this.ingestVideosSync(freshProfile, firstBatch);
    } catch (err: any) {
      await this.prisma.scraperBilibiliProfile.update({
        where: { id: profile.id },
        data: { scraping_status: 'failed', scrape_error: (err.message || '').slice(0, 500) },
      });
      // Profile vừa tạo mà lỗi ngay từ đầu → xóa placeholder, tránh rác DB.
      if (wasCreated) {
        await this.prisma.scraperBilibiliProfile.delete({ where: { id: profile.id } }).catch(() => {});
      }
      // AI service đã nói rõ nguyên nhân (vd token TikHub hết hạn) → ném NGUYÊN VĂN cho
      // AllExceptionsFilter dịch lại. Bọc thành 400 ở đây vừa nuốt mất lý do thật, vừa
      // đổi "hỏng ở nhà cung cấp" thành "người dùng nhập sai".
      if (readAiServiceError(err)) throw err;
      throw new HttpException({ error: err.message || 'Không cào được profile này' }, HttpStatus.BAD_REQUEST);
    }

    if (result.items_returned === 0) {
      await this.prisma.scraperBilibiliProfile.update({
        where: { id: profile.id },
        data: {
          scraping_status: 'idle',
          scrape_error: 'Không có video nào được trả về (user không tồn tại hoặc không có video)',
        },
      });
      if (wasCreated) {
        await this.prisma.scraperBilibiliProfile.delete({ where: { id: profile.id } }).catch(() => {});
      }
      throw new HttpException({ error: 'Không tìm thấy video cho mid này' }, HttpStatus.NOT_FOUND);
    }

    // Dispatch cào tiếp tới tổng targetCount video (fire-and-forget) — tự set scraping_status='completed'
    const continuationNeeded = targetCount > firstBatch;
    if (continuationNeeded) {
      this.scrapeProfileVideos(profile.id, targetCount).catch((err) => {
        this.logger.error(`[BILIBILI-PROFILE] ${mid} continuation thất bại: ${err.message}`);
      });
    } else {
      // Không có phần chạy nền → tự chốt trạng thái, tránh kẹt 'processing'.
      await this.prisma.scraperBilibiliProfile.update({
        where: { id: profile.id },
        data: {
          scraping_status: 'completed',
          scrape_error: null,
          is_initial_scraped: true,
          last_scraped_at: new Date(),
        },
      });
    }

    const updated = await this.prisma.scraperBilibiliProfile.findUniqueOrThrow({ where: { id: profile.id } });

    const batchInfo = `${result.items_returned} video (${result.created} mới)`;
    return {
      status: 'ok',
      message: continuationNeeded
        ? `Đã cào ${batchInfo} cho kênh ${updated.nickname || mid}. Đang cào tiếp tới ${targetCount}...`
        : `Đã cào ${batchInfo} cho kênh ${updated.nickname || mid}.`,
      profile_id: Number(updated.id),
      newly_scraped: true,
    };
  }

  // ─── Toggle bookmark/tracked ─────────────────────────────────────────────

  async toggleProfile(id: bigint, field: 'is_bookmarked' | 'is_tracked'): Promise<boolean> {
    const profile = await this.prisma.scraperBilibiliProfile.findUnique({ where: { id } });
    if (!profile) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    const newValue = !profile[field];
    await this.prisma.scraperBilibiliProfile.update({ where: { id }, data: { [field]: newValue } });
    return newValue;
  }

  // Tự mở khóa profile bị kẹt ở 'processing' quá lâu (worker crash giữa chừng).
  private async resetStaleLocks(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000);
    const result = await this.prisma.scraperBilibiliProfile.updateMany({
      where: { scraping_status: 'processing', updated_at: { lt: cutoff } },
      data: { scraping_status: 'idle' },
    });
    if (result.count > 0) {
      this.logger.warn(`⚠️ Reset ${result.count} profile Bilibili bị stuck lock`);
    }
  }

  // ─── Periodic: cào video mới cho profile is_tracked=true (cron) ──────────
  // is_tracked là tiêu chí chọn lọc duy nhất; scraping_status chỉ dùng để loại trừ
  // profile đang cào dở (!= 'processing'), không so khớp cứng 1 giá trị cụ thể.

  // ─── Auto re-run từ khoá đã search nhiều nhất (cron riêng, khác giờ periodicRefresh) ──
  private static readonly MAX_AUTO_RERUN_KEYWORDS_PER_CRON = 3;
  private static readonly MIN_HIT_COUNT_FOR_AUTO_RERUN = 3;

  async autoRerunTopKeywords(): Promise<{ keywords: string[]; created: number; updated: number }> {
    const { suggestions } = await this.readService.keywordSuggest('');
    const keywords = suggestions
      .filter((s) => s.count >= BilibiliScraperService.MIN_HIT_COUNT_FOR_AUTO_RERUN)
      .slice(0, BilibiliScraperService.MAX_AUTO_RERUN_KEYWORDS_PER_CRON)
      .map((s) => s.keyword);

    let created = 0;
    let updated = 0;
    for (const keyword of keywords) {
      try {
        // Từ khoá lưu trong DB là TIẾNG VIỆT (user gõ) — Bilibili chỉ ra kết quả tốt với
        // tiếng Trung nên phải dịch lại trước khi query; giữ tiếng Việt khi lưu lại.
        const { translated } = await this.aiIntegration.translateSearchKeyword(keyword);
        const r = await this.searchKeyword(translated, 30, keyword);
        created += r.created;
        updated += r.updated;
      } catch (err: any) {
        this.logger.error(`[BILIBILI-AUTO-RERUN] '${keyword}' thất bại: ${err.message}`);
      }
    }

    this.logger.log(`[BILIBILI-AUTO-RERUN] Rerun ${keywords.length} từ khoá: ${keywords.join(', ') || '(không có)'}`);
    return { keywords, created, updated };
  }

  async periodicRefresh(): Promise<{ total: number; done: number; failed: number }> {
    await this.resetStaleLocks();

    const profiles = await this.prisma.scraperBilibiliProfile.findMany({
      where: { is_tracked: true, is_initial_scraped: true, scraping_status: { not: 'processing' } },
      orderBy: { last_scraped_at: 'asc' },
    });

    if (profiles.length === 0) {
      this.logger.log('[BILIBILI-PERIODIC] Không có profile nào cần cào định kỳ.');
      return { total: 0, done: 0, failed: 0 };
    }

    this.logger.log(`═══ [BILIBILI-PERIODIC] Cào video mới cho ${profiles.length} profile(s) ═══`);
    let done = 0;
    let failed = 0;

    for (const profile of profiles) {
      try {
        await this.scrapeProfileVideos(profile.id, 10);
        done++;
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ ${profile.nickname || profile.mid}: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    this.logger.log(`═══ [BILIBILI-PERIODIC] Xong: ${done}/${profiles.length} OK, ${failed} lỗi ═══`);
    return { total: profiles.length, done, failed };
  }
}
