import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DEFAULT_TARGET_COUNT } from '../../common/utils/target-count.util';
import { DeleteChannelResult, buildDeleteChannelResult } from '../../common/utils/delete-channel.util';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';
import { XiaohongshuAiClientService, ParsedXhsVideo, ParsedXhsAuthor } from './xiaohongshu-ai-client.service';
import { XiaohongshuScraperReadService } from './xiaohongshu-scraper-read.service';

const STALE_LOCK_MINUTES = 30;

// Toàn bộ logic ghi DB port từ AI (tikhub_xiaohongshu.py::ingest_xiaohongshu_videos/
// ingest_xhs_profile_videos/upsert_xhs_profile đã xóa + xiaohongshu_search_views.py::
// search_xiaohongshu_notes/xhs_profile_scrape/PATCH của xhs_profile_detail).
// AI giờ chỉ fetch + parse (xiaohongshu_fetch_views.py), BE là nơi duy nhất ghi
// scraper_xiaohongshu_videos / scraper_xiaohongshu_profiles.
//
// scrape_xhs_profile_task chưa từng được implement bên AI (task không tồn tại — mọi lời
// gọi profile-scrape/cron định kỳ trước đây đều lỗi). Logic bên dưới được viết mới, dựa
// theo thiết kế rõ ràng từ view gốc (xhs_profile_scrape) + parse functions đã có sẵn,
// mirror pattern TikTok/Douyin/Instagram.
@Injectable()
export class XiaohongshuScraperService {
  private readonly logger = new Logger(XiaohongshuScraperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: XiaohongshuAiClientService,
    private readonly readService: XiaohongshuScraperReadService,
    private readonly aiIntegration: AiIntegrationService,
  ) {}

  private async upsertVideo(
    v: ParsedXhsVideo,
    opts: { keyword?: string; profileId?: bigint } = {},
  ): Promise<{ created: boolean }> {
    const existing = await this.prisma.scraperXiaohongshuVideo.findUnique({ where: { note_id: v.note_id } });

    const data: any = {
      url: v.url,
      title: v.title,
      description: v.description,
      thumbnail_url: v.thumbnail_url,
      author_id: v.author_id,
      author_name: v.author_name,
      author_avatar: v.author_avatar,
      duration_seconds: v.duration_seconds,
      liked_count: BigInt(v.liked_count || 0),
      collected_count: BigInt(v.collected_count || 0),
      comments_count: BigInt(v.comments_count || 0),
      shared_count: BigInt(v.shared_count || 0),
      date_posted: new Date(v.date_posted),
    };
    if (opts.profileId !== undefined) data.profile_id = opts.profileId;

    if (existing) {
      if (opts.keyword && !existing.keywords.includes(opts.keyword)) {
        data.keywords = Array.from(new Set([...existing.keywords, opts.keyword]));
      }
      await this.prisma.scraperXiaohongshuVideo.update({ where: { note_id: v.note_id }, data });
      return { created: false };
    }
    if (opts.keyword) data.keywords = [opts.keyword];
    await this.prisma.scraperXiaohongshuVideo.create({ data: { ...data, note_id: v.note_id } });
    return { created: true };
  }

  // ─── Keyword search ────────────────────────────────────────────────────────

  // Dedup (note_id đã có trong DB) làm giảm số video MỚI thực sự ingest được so
  // với `count` yêu cầu — vòng lặp dưới đây gọi tiếp AI với cursor nối tiếp
  // (không lặp lại từ đầu) để bù phần bị trùng, tối đa MAX_SEARCH_ROUNDS lần.
  private static readonly MAX_SEARCH_ROUNDS = 5;

  // ─── Auto-discover kênh mới từ tác giả xuất hiện trong kết quả search ──────
  // Xiaohongshu không có follower count trong search-video, dùng liked_count
  // làm ranking signal thay thế. is_tracked ép về false (schema default của
  // model này là true, khác biệt có sẵn — ép override để auto-discover không
  // tự động lọt vào cron định kỳ, giống hệt quyết định chung cho cả 4 nền tảng).
  private static readonly MAX_AUTO_DISCOVER_PER_SEARCH = 5;
  private static readonly MIN_AUTO_DISCOVER_LIKES = 500;

  private async autoDiscoverNewAuthors(candidates: Map<string, number>): Promise<string[]> {
    const ranked = Array.from(candidates.entries())
      .filter(([, likes]) => likes >= XiaohongshuScraperService.MIN_AUTO_DISCOVER_LIKES)
      .sort((a, b) => b[1] - a[1])
      .slice(0, XiaohongshuScraperService.MAX_AUTO_DISCOVER_PER_SEARCH)
      .map(([userId]) => userId);

    if (ranked.length === 0) return [];

    const existing = await this.prisma.scraperXiaohongshuProfile.findMany({
      where: { user_id: { in: ranked } },
      select: { user_id: true },
    });
    const existingSet = new Set(existing.map((p) => p.user_id));
    const newUserIds = ranked.filter((id) => !existingSet.has(id));

    for (const userId of newUserIds) {
      this.scrapeProfile(userId, false, false).catch((err) => {
        this.logger.error(`[XHS-AUTO-DISCOVER] ${userId} thất bại: ${err.message}`);
      });
    }

    if (newUserIds.length > 0) {
      this.logger.log(`[XHS-AUTO-DISCOVER] Phát hiện + dispatch cào ${newUserIds.length} kênh mới: ${newUserIds.join(', ')}`);
    }
    return newUserIds;
  }

  /**
   * @param keyword       Từ khoá GỬI ĐI để query (tiếng Trung với nền tảng TQ).
   * @param displayKeyword Từ khoá LƯU vào DB để hiển thị (tiếng Việt user gõ). Bỏ trống = dùng `keyword`.
   */
  async searchKeyword(
    keyword: string,
    count = 20,
    displayKeyword?: string,
  ): Promise<{ created: number; updated: number; auto_discovered: string[] }> {
    let created = 0;
    let updated = 0;
    let cursor: unknown = undefined;
    let hasMore = true;
    const authorCandidates = new Map<string, number>();
    // Lưu tiếng Việt user gõ (nếu có) thay vì tiếng Trung đã query — bộ lọc/gợi ý dễ đọc hơn.
    const storedKeyword = (displayKeyword || '').trim() || keyword;

    for (let round = 0; round < XiaohongshuScraperService.MAX_SEARCH_ROUNDS && created < count && hasMore; round++) {
      const remaining = count - created;
      const { videos, cursor: nextCursor, has_more } = await this.aiClient.fetchSearch(keyword, remaining, cursor);
      if (videos.length === 0) break;

      for (const v of videos) {
        const r = await this.upsertVideo(v, { keyword: storedKeyword });
        if (r.created) created++;
        else updated++;

        if (v.author_id) {
          const prevMax = authorCandidates.get(v.author_id) ?? 0;
          authorCandidates.set(v.author_id, Math.max(prevMax, v.liked_count ?? 0));
        }
      }

      cursor = nextCursor;
      hasMore = has_more;
    }

    this.logger.log(`[XHS] Ingest '${keyword}'${storedKeyword !== keyword ? ` (lưu '${storedKeyword}')` : ''}: +${created} new, ~${updated} updated`);

    const auto_discovered = await this.autoDiscoverNewAuthors(authorCandidates);
    return { created, updated, auto_discovered };
  }

  // ─── Profile: cào theo user_id (dùng chung cho profile mới/đã tồn tại + cron) ──

  // Khớp update_or_create defaults cũ: chỉ ghi đè field khi có giá trị.
  private async applyAuthorUpdate(profileId: bigint, author: ParsedXhsAuthor): Promise<void> {
    const data: any = { is_verified: author.is_verified };
    if (author.nickname) data.nickname = author.nickname;
    if (author.avatar_url) data.avatar_url = author.avatar_url;
    await this.prisma.scraperXiaohongshuProfile.update({ where: { id: profileId }, data });
  }

  private async toProfileDict(profile: any, includeVideoCount = false): Promise<any> {
    const dict: any = {
      id: Number(profile.id),
      user_id: profile.user_id,
      nickname: profile.nickname,
      avatar_url: profile.avatar_url || '',
      is_verified: profile.is_verified,
      is_tracked: profile.is_tracked,
      is_bookmarked: profile.is_bookmarked,
      is_owned: profile.is_owned,
      is_initial_scraped: profile.is_initial_scraped,
      last_scraped_at: profile.last_scraped_at,
      scraping_status: profile.scraping_status,
      scrape_error: profile.scrape_error,
      created_at: profile.created_at,
    };
    if (includeVideoCount) {
      dict.videos_count = await this.prisma.scraperXiaohongshuVideo.count({ where: { profile_id: profile.id } });
    }
    return dict;
  }

  async scrapeProfileVideos(
    profileId: bigint,
    numOfPosts: number,
  ): Promise<{ created: number; updated: number; videos_returned: number }> {
    const profile = await this.prisma.scraperXiaohongshuProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new Error(`Profile ${profileId} không tồn tại`);

    await this.prisma.scraperXiaohongshuProfile.update({
      where: { id: profileId },
      data: { scraping_status: 'processing', scrape_error: null },
    });

    try {
      const { author, videos } = await this.aiClient.fetchProfileVideos(profile.user_id, numOfPosts);

      if (videos.length === 0) {
        await this.prisma.scraperXiaohongshuProfile.update({
          where: { id: profileId },
          data: {
            scraping_status: 'idle',
            scrape_error: 'Không có video được trả về (user không tồn tại hoặc không có video)',
          },
        });
        return { created: 0, updated: 0, videos_returned: 0 };
      }

      if (author) await this.applyAuthorUpdate(profileId, author);

      let created = 0;
      let updated = 0;
      for (const v of videos) {
        const r = await this.upsertVideo(v, { profileId });
        if (r.created) created++;
        else updated++;
      }

      await this.prisma.scraperXiaohongshuProfile.update({
        where: { id: profileId },
        data: { is_initial_scraped: true, last_scraped_at: new Date(), scraping_status: 'idle', scrape_error: null },
      });

      const freshProfile = await this.prisma.scraperXiaohongshuProfile.findUniqueOrThrow({ where: { id: profileId } });
      const label = freshProfile.nickname || profile.user_id;
      this.logger.log(`[XHS-PROFILE] ${label}: +${created} mới, ~${updated} cập nhật`);
      return { created, updated, videos_returned: videos.length };
    } catch (err: any) {
      await this.prisma.scraperXiaohongshuProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'failed', scrape_error: (err.message || '').slice(0, 500) },
      });
      throw err;
    }
  }

  // Batch đầu SYNCHRONOUS (~20 video) — chỉ fetch + upsert, KHÔNG đổi scraping_status
  // (giữ nguyên 'processing' để phần nền tiếp tục), khớp pattern TikTok/Douyin.
  private async ingestProfileVideosSync(
    profile: { id: bigint; user_id: string },
    count: number,
  ): Promise<{ created: number; updated: number; videos_returned: number }> {
    const { author, videos } = await this.aiClient.fetchProfileVideos(profile.user_id, count);
    if (videos.length === 0) return { created: 0, updated: 0, videos_returned: 0 };

    if (author) await this.applyAuthorUpdate(profile.id, author);

    let created = 0;
    let updated = 0;
    for (const v of videos) {
      const r = await this.upsertVideo(v, { profileId: profile.id });
      if (r.created) created++;
      else updated++;
    }
    return { created, updated, videos_returned: videos.length };
  }

  // initialIsTracked: chỉ dùng bởi luồng auto-discover (ép is_tracked=false ngay
  // lúc tạo) — schema default của model này là true, khác biệt có sẵn so với 3
  // nền tảng còn lại. Luồng thêm profile thủ công (controller) không truyền
  // tham số này nên giữ nguyên hành vi cũ (kế thừa default true).
  async scrapeProfile(
    userId: string,
    isOwned?: boolean,
    initialIsTracked?: boolean,
    targetCount = DEFAULT_TARGET_COUNT,
  ): Promise<any> {
    let profile = await this.prisma.scraperXiaohongshuProfile.findUnique({ where: { user_id: userId } });
    const wasCreated = !profile;
    if (!profile) {
      profile = await this.prisma.scraperXiaohongshuProfile.create({
        data: {
          user_id: userId,
          scraping_status: 'idle',
          is_owned: !!isOwned,
          ...(initialIsTracked !== undefined ? { is_tracked: initialIsTracked } : {}),
        },
      });
    }

    if (profile.scraping_status === 'processing') {
      throw new HttpException({ error: 'Profile đang được cào, vui lòng đợi' }, HttpStatus.BAD_REQUEST);
    }

    const needsDeltaScrape = !wasCreated && profile.is_initial_scraped;

    const updateData: any = { scraping_status: 'processing', scrape_error: null };
    if (isOwned && !profile.is_owned) updateData.is_owned = true;
    await this.prisma.scraperXiaohongshuProfile.update({ where: { id: profile.id }, data: updateData });

    if (needsDeltaScrape) {
      // Delta: kênh đã cào rồi, lấy thêm tới targetCount video mới nhất, fully async
      this.scrapeProfileVideos(profile.id, targetCount).catch((err) => {
        this.logger.error(`[XHS-PROFILE] ${userId} thất bại: ${err.message}`);
      });
      return {
        status: 'ok',
        message: `Đang cập nhật tới ${targetCount} video mới nhất cho user ${userId}...`,
        profile: await this.toProfileDict(profile),
        created: wasCreated,
      };
    }

    // Batch đầu SYNCHRONOUS (nhỏ, rất nhanh) — trả data ngay cho user, phần còn lại chạy nền
    const firstBatch = Math.min(20, targetCount);
    const freshProfile = await this.prisma.scraperXiaohongshuProfile.findUniqueOrThrow({ where: { id: profile.id } });
    const result = await this.ingestProfileVideosSync(freshProfile, firstBatch);

    if (result.videos_returned === 0) {
      if (wasCreated) {
        await this.prisma.scraperXiaohongshuProfile.delete({ where: { id: profile.id } }).catch(() => {});
      } else {
        await this.prisma.scraperXiaohongshuProfile.update({
          where: { id: profile.id },
          data: { scraping_status: 'idle', scrape_error: 'Không có video được trả về (user không tồn tại hoặc không có video)' },
        });
      }
      throw new HttpException({ error: 'Không tìm thấy video cho user_id này' }, HttpStatus.NOT_FOUND);
    }

    // Dispatch cào tiếp tới tổng targetCount video (fire-and-forget) — tự set scraping_status='idle'
    const continuationNeeded = targetCount > firstBatch;
    if (continuationNeeded) {
      this.scrapeProfileVideos(profile.id, targetCount).catch((err) => {
        this.logger.error(`[XHS-PROFILE] ${userId} continuation thất bại: ${err.message}`);
      });
    } else {
      // Không có phần chạy nền → tự chốt trạng thái, tránh kẹt 'processing'.
      // XHS dùng 'idle' làm trạng thái kết thúc (không có 'completed' như các nền tảng khác).
      await this.prisma.scraperXiaohongshuProfile.update({
        where: { id: profile.id },
        data: {
          scraping_status: 'idle',
          scrape_error: null,
          is_initial_scraped: true,
          last_scraped_at: new Date(),
        },
      });
    }

    const updatedProfile = await this.prisma.scraperXiaohongshuProfile.findUniqueOrThrow({ where: { id: profile.id } });

    const batchInfo = `${result.videos_returned} video (${result.created} mới)`;
    return {
      status: 'ok',
      message: continuationNeeded
        ? `Đã cào ${batchInfo} cho user ${userId}. Đang cào tiếp tới ${targetCount}...`
        : `Đã cào ${batchInfo} cho user ${userId}.`,
      profile: await this.toProfileDict(updatedProfile),
      created: wasCreated,
    };
  }

  // ─── Patch (toggle) tracked/bookmarked — khớp PATCH xhs_profile_detail cũ ────

  async patchProfile(id: bigint, patch: { is_tracked?: boolean; is_bookmarked?: boolean }): Promise<any> {
    const profile = await this.prisma.scraperXiaohongshuProfile.findUnique({ where: { id } });
    if (!profile) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);

    const data: any = {};
    if (patch.is_tracked !== undefined) data.is_tracked = !!patch.is_tracked;
    if (patch.is_bookmarked !== undefined) data.is_bookmarked = !!patch.is_bookmarked;

    const updated = Object.keys(data).length > 0
      ? await this.prisma.scraperXiaohongshuProfile.update({ where: { id }, data })
      : profile;

    return this.toProfileDict(updated, true);
  }

  // ─── Xoá cứng kênh ──────────────────────────────────────────────────────────

  // Khác 6 nền tảng cascade: khoá ngoại của XHS là onDelete SetNull, nên xoá profile
  // KHÔNG dọn video mà chỉ set profile_id = null. Video mồ côi kiểu đó không còn thuộc
  // kênh nào để xoá qua UI nữa, nhưng vẫn nằm trong DB và vẫn lọt vào truy vấn gom toàn
  // bộ video. Vì vậy phải chủ động deleteMany trước.
  async deleteProfile(id: bigint): Promise<DeleteChannelResult> {
    const profile = await this.prisma.scraperXiaohongshuProfile.findUnique({ where: { id } });
    if (!profile) throw new HttpException({ error: 'Không tìm thấy kênh' }, HttpStatus.NOT_FOUND);

    const { count } = await this.prisma.scraperXiaohongshuVideo.deleteMany({ where: { profile_id: id } });
    await this.prisma.scraperXiaohongshuProfile.delete({ where: { id } });

    const name = profile.nickname || profile.user_id;
    this.logger.warn(`[XHS] Đã xoá cứng kênh "${name}" (id=${id}) kèm ${count} video.`);
    return buildDeleteChannelResult(id, name, count);
  }

  // Tự mở khóa profile bị kẹt ở 'processing' quá lâu (worker crash giữa chừng), tránh
  // bị loại khỏi cron định kỳ vĩnh viễn — khớp pattern _reset_stale_locks() của Facebook.
  private async resetStaleLocks(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000);
    const result = await this.prisma.scraperXiaohongshuProfile.updateMany({
      where: { scraping_status: 'processing', updated_at: { lt: cutoff } },
      data: { scraping_status: 'idle' },
    });
    if (result.count > 0) {
      this.logger.warn(`⚠️ Reset ${result.count} profile Xiaohongshu bị stuck lock`);
    }
  }

  // ─── Periodic: cào video mới cho profile is_tracked=true (cron) ─────────
  // is_tracked là tiêu chí chọn lọc duy nhất; scraping_status chỉ dùng để loại trừ
  // profile đang cào dở (!= 'processing'), không so khớp cứng 1 giá trị cụ thể.

  // ─── Auto re-run từ khoá đã search nhiều nhất (cron riêng, khác giờ periodicRefresh) ──
  // keywordSuggest() của Xiaohongshu trả về array trực tiếp (khác 4 platform kia
  // trả {suggestions: [...]}) — xử lý riêng, không giả định chung 1 shape.
  private static readonly MAX_AUTO_RERUN_KEYWORDS_PER_CRON = 3;
  private static readonly MIN_HIT_COUNT_FOR_AUTO_RERUN = 3;

  async autoRerunTopKeywords(): Promise<{ keywords: string[]; created: number; updated: number }> {
    const suggestions = await this.readService.keywordSuggest('');
    const keywords = suggestions
      .filter((s) => s.count >= XiaohongshuScraperService.MIN_HIT_COUNT_FOR_AUTO_RERUN)
      .slice(0, XiaohongshuScraperService.MAX_AUTO_RERUN_KEYWORDS_PER_CRON)
      .map((s) => s.keyword);

    let created = 0;
    let updated = 0;
    for (const keyword of keywords) {
      try {
        // Từ khoá lưu trong DB là TIẾNG VIỆT (user gõ) — Xiaohongshu chỉ ra kết quả tốt với
        // tiếng Trung nên phải dịch lại trước khi query; giữ tiếng Việt khi lưu lại.
        const { translated } = await this.aiIntegration.translateSearchKeyword(keyword);
        const r = await this.searchKeyword(translated, 20, keyword);
        created += r.created;
        updated += r.updated;
      } catch (err: any) {
        this.logger.error(`[XHS-AUTO-RERUN] '${keyword}' thất bại: ${err.message}`);
      }
    }

    this.logger.log(`[XHS-AUTO-RERUN] Rerun ${keywords.length} từ khoá: ${keywords.join(', ') || '(không có)'}`);
    return { keywords, created, updated };
  }

  /** Cron định kỳ: chỉ làm mới kênh đã đánh dấu chú ý. */
  async periodicRefresh(): Promise<{ total: number; done: number; failed: number }> {
    return this.refreshProfiles(true);
  }

  /**
   * Nút "Đồng bộ tất cả" trên UI: làm mới MỌI kênh, không cần đánh dấu chú ý.
   *
   * Mỗi lượt gọi API bên thứ ba đều tính tiền, nên khoá lại không cho chạy hai lượt song
   * song — người dùng nhấp đúp là trả tiền gấp đôi mà không được gì thêm.
   */
  async syncAllProfiles(): Promise<{ total: number; done: number; failed: number; already_running?: boolean }> {
    if (this.syncAllRunning) {
      return { total: 0, done: 0, failed: 0, already_running: true };
    }
    this.syncAllRunning = true;
    try {
      return await this.refreshProfiles(false);
    } finally {
      this.syncAllRunning = false;
    }
  }

  private syncAllRunning = false;

  /** Controller hỏi trước khi dispatch, để trả lời ngay thay vì chờ hết lượt cào. */
  isSyncAllRunning(): boolean {
    return this.syncAllRunning;
  }

  private async refreshProfiles(trackedOnly: boolean): Promise<{ total: number; done: number; failed: number }> {
    await this.resetStaleLocks();

    const profiles = await this.prisma.scraperXiaohongshuProfile.findMany({
      where: {
        // Cron chỉ đụng kênh đã cào lần đầu: cào lần đầu tốn nhiều lượt API hơn hẳn cào
        // delta, để cron tự ý làm là mở đường cho hoá đơn phình mà không ai theo dõi.
        // Nút "Đồng bộ tất cả" thì ngược lại — có người bấm và đã xác nhận, nên phải với
        // tới được cả kênh chưa có video nào.
        ...(trackedOnly ? { is_tracked: true, is_initial_scraped: true } : {}),
        scraping_status: { not: 'processing' },
      },
      orderBy: { last_scraped_at: 'asc' },
    });

    if (profiles.length === 0) {
      this.logger.log('[XHS-PERIODIC] Không có profile nào cần cào định kỳ.');
      return { total: 0, done: 0, failed: 0 };
    }

    this.logger.log(`═══ [XHS-PERIODIC] Cào video mới cho ${profiles.length} profile(s) ═══`);
    let done = 0;
    let failed = 0;

    for (const profile of profiles) {
      try {
        await this.scrapeProfileVideos(profile.id, 10);
        done++;
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ ${profile.nickname || profile.user_id}: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    this.logger.log(`═══ [XHS-PERIODIC] Xong: ${done}/${profiles.length} OK, ${failed} lỗi ═══`);
    return { total: profiles.length, done, failed };
  }
}
