import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../task-auto/notifications/notifications.service';
import { DEFAULT_TARGET_COUNT } from '../../common/utils/target-count.util';
import { DeleteChannelResult, buildDeleteChannelResult } from '../../common/utils/delete-channel.util';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';
import { DouyinAiClientService, ParsedDouyinVideo } from './douyin-ai-client.service';
import { DouyinScraperReadService } from './douyin-scraper-read.service';

function isDriveUrl(url?: string | null): boolean {
  return !!url && (url.includes('drive.google.com') || url.includes('googleusercontent.com'));
}

const STALE_LOCK_MINUTES = 30;

// Toàn bộ logic ghi DB port từ AI (tikhub_douyin.py::ingest_douyin_videos đã xóa +
// scraper_views.py::douyin_keyword_search/douyin_profile_scrape/douyin_profile_toggle +
// tasks.py::search_douyin_keyword_task/scrape_douyin_profile_task/periodic_scrape_douyin_profiles_task).
// AI giờ chỉ fetch + parse (douyin_fetch_views.py), BE là nơi duy nhất ghi
// scraper_douyin_videos / scraper_douyin_profiles.
@Injectable()
export class DouyinScraperService {
  private readonly logger = new Logger(DouyinScraperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: DouyinAiClientService,
    private readonly notifications: NotificationsService,
    private readonly readService: DouyinScraperReadService,
    private readonly aiIntegration: AiIntegrationService,
  ) {}

  // ─── Growth Alert: snapshot followers + báo động nếu tăng đột biến ────────
  // Douyin chỉ có followers_count cấp profile (không có following/likes), khớp
  // đúng field sẵn có trên ScraperDouyinProfile.
  private static readonly GROWTH_ALERT_THRESHOLD_PCT = 0.2;

  private async recordMetricsAndMaybeAlert(profileId: bigint, profileName: string): Promise<void> {
    const fresh = await this.prisma.scraperDouyinProfile.findUniqueOrThrow({ where: { id: profileId } });
    const previous = await this.prisma.scraperDouyinProfileMetrics.findFirst({
      where: { profile_id: profileId },
      orderBy: { captured_at: 'desc' },
    });

    await this.prisma.scraperDouyinProfileMetrics.create({
      data: { profile_id: profileId, followers_count: fresh.followers_count },
    });

    if (!previous || previous.followers_count <= 0n) return;
    const growth = Number(fresh.followers_count - previous.followers_count) / Number(previous.followers_count);
    if (growth < DouyinScraperService.GROWTH_ALERT_THRESHOLD_PCT) return;

    const pct = Math.round(growth * 100);
    await this.notifications.broadcastToActiveUsers(
      'GROWTH_ALERT',
      `Kênh Douyin @${profileName} tăng trưởng đột biến`,
      `Followers tăng ${pct}% (${previous.followers_count} → ${fresh.followers_count}) kể từ lần cào trước.`,
      { platform: 'douyin', profile_id: Number(profileId) },
    );
  }

  // ─── Upsert 1 video (giữ nguyên business rule preserve Drive URL / keyword cũ) ──

  private async upsertVideo(v: ParsedDouyinVideo, keywordOverride?: string): Promise<{ created: boolean }> {
    const existing = await this.prisma.scraperDouyinVideo.findUnique({ where: { post_id: v.post_id } });

    const preview_image = existing && isDriveUrl(existing.preview_image) ? existing.preview_image : v.thumbnail_url;
    // keywordOverride ưu tiên hơn v.search_keyword: khi user gõ tiếng Việt rồi dịch sang
    // tiếng Trung để query, ta vẫn muốn LƯU tiếng Việt cho dễ đọc ở bộ lọc/gợi ý.
    // (Nhánh cào profile truyền override='@label' và v.search_keyword rỗng nên không đổi.)
    const resolvedKeyword = keywordOverride || v.search_keyword || '';
    const search_keyword = existing?.search_keyword || resolvedKeyword;

    const data = {
      url: v.url,
      description: v.description,
      hashtags: v.hashtags,
      preview_image,
      video_duration: v.video_duration,
      region: v.region,
      author_id: v.author_id,
      author_username: v.author_username,
      author_display_name: v.author_display_name,
      author_avatar: v.author_avatar,
      author_followers: BigInt(v.author_followers || 0),
      author_is_verified: v.author_is_verified,
      digg_count: BigInt(v.digg_count || 0),
      comment_count: BigInt(v.comment_count || 0),
      share_count: BigInt(v.share_count || 0),
      collect_count: BigInt(v.collect_count || 0),
      music_title: v.music_title,
      music_author: v.music_author,
      search_keyword,
      date_posted: new Date(v.date_posted),
    };

    if (existing) {
      await this.prisma.scraperDouyinVideo.update({ where: { post_id: v.post_id }, data });
      return { created: false };
    }
    await this.prisma.scraperDouyinVideo.create({ data: { ...data, post_id: v.post_id } });
    return { created: true };
  }

  // ─── Keyword search ────────────────────────────────────────────────────────

  // Dedup (post_id đã có trong DB) làm giảm số video MỚI thực sự ingest được so
  // với `count` yêu cầu — vòng lặp dưới đây gọi tiếp AI với cursor nối tiếp
  // (không lặp lại từ đầu) để bù phần bị trùng, tối đa MAX_SEARCH_ROUNDS lần.
  private static readonly MAX_SEARCH_ROUNDS = 5;

  /**
   * @param keyword       Từ khoá GỬI ĐI để query (tiếng Trung với nền tảng TQ).
   * @param displayKeyword Từ khoá LƯU vào DB để hiển thị (tiếng Việt user gõ). Bỏ trống = dùng `keyword`.
   */
  async searchKeyword(
    keyword: string,
    count = 30,
    displayKeyword?: string,
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    let cursor: unknown = undefined;
    let hasMore = true;
    const storedKeyword = (displayKeyword || '').trim() || undefined;

    for (let round = 0; round < DouyinScraperService.MAX_SEARCH_ROUNDS && created < count && hasMore; round++) {
      const remaining = count - created;
      const { videos, cursor: nextCursor, has_more } = await this.aiClient.fetchSearch(keyword, remaining, cursor);
      if (videos.length === 0) break;

      for (const v of videos) {
        const r = await this.upsertVideo(v, storedKeyword);
        if (r.created) created++;
        else updated++;
      }

      cursor = nextCursor;
      hasMore = has_more;
    }

    this.logger.log(`[DOUYIN] Ingest '${keyword}'${storedKeyword ? ` (lưu '${storedKeyword}')` : ''}: +${created} new, ~${updated} updated`);
    return { created, updated };
  }

  // ─── Profile: cào theo sec_user_id (dùng chung cho profile mới/đã tồn tại + cron) ──

  async scrapeProfileVideos(
    profileId: bigint,
    numOfPosts: number,
  ): Promise<{ created: number; updated: number; videos_returned: number }> {
    const profile = await this.prisma.scraperDouyinProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new Error(`Profile ${profileId} không tồn tại`);

    await this.prisma.scraperDouyinProfile.update({
      where: { id: profileId },
      data: { scraping_status: 'processing', scrape_error: null },
    });

    try {
      const { author, videos } = await this.aiClient.fetchProfileVideos(profile.sec_user_id, numOfPosts);

      if (videos.length === 0) {
        await this.prisma.scraperDouyinProfile.update({
          where: { id: profileId },
          data: {
            scraping_status: 'idle',
            scrape_error: 'Không có video được trả về (profile không tồn tại hoặc không có video)',
          },
        });
        return { created: 0, updated: 0, videos_returned: 0 };
      }

      const label = author?.username || profile.username || profile.sec_user_id.slice(0, 20);

      const profileUpdateData: any = {
        is_initial_scraped: true,
        last_scraped_at: new Date(),
        scraping_status: 'idle',
        scrape_error: null,
      };
      if (author) {
        if (author.uid) profileUpdateData.uid = author.uid;
        if (author.username) profileUpdateData.username = author.username;
        if (author.nickname) profileUpdateData.nickname = author.nickname;
        if (author.biography) profileUpdateData.biography = author.biography;
        profileUpdateData.is_verified = author.is_verified;
        if (author.avatar_url) profileUpdateData.avatar_url = author.avatar_url;
        if (author.followers_count !== null && author.followers_count !== undefined) {
          profileUpdateData.followers_count = BigInt(author.followers_count);
        }
      }

      let created = 0;
      let updated = 0;
      for (const v of videos) {
        const r = await this.upsertVideo(v, `@${label}`);
        if (r.created) created++;
        else updated++;
      }

      await this.prisma.scraperDouyinProfile.update({ where: { id: profileId }, data: profileUpdateData });

      this.recordMetricsAndMaybeAlert(profileId, label).catch((err) => {
        this.logger.error(`[DOUYIN-GROWTH-ALERT] ${label}: ${err.message}`);
      });

      this.logger.log(`[DOUYIN-PROFILE] @${label}: +${created} mới, ~${updated} cập nhật`);
      return { created, updated, videos_returned: videos.length };
    } catch (err: any) {
      await this.prisma.scraperDouyinProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'failed', scrape_error: (err.message || '').slice(0, 500) },
      });
      throw err;
    }
  }

  async scrapeProfile(secUserId: string, isOwned?: boolean, targetCount = DEFAULT_TARGET_COUNT): Promise<any> {
    let profile = await this.prisma.scraperDouyinProfile.findUnique({ where: { sec_user_id: secUserId } });
    const wasCreated = !profile;
    if (!profile) {
      profile = await this.prisma.scraperDouyinProfile.create({
        data: { sec_user_id: secUserId, scraping_status: 'idle', is_owned: !!isOwned },
      });
    }

    // Profile đã tồn tại → dispatch task cào delta (fire-and-forget), trả về ngay
    if (!wasCreated) {
      const data: any = { scraping_status: 'processing', scrape_error: null };
      if (isOwned && !profile.is_owned) data.is_owned = true;
      await this.prisma.scraperDouyinProfile.update({ where: { id: profile.id }, data });

      this.scrapeProfileVideos(profile.id, targetCount).catch((err) => {
        this.logger.error(`[DOUYIN-PROFILE] ${secUserId} thất bại: ${err.message}`);
      });

      return {
        status: 'ok',
        message: `Đang cập nhật tới ${targetCount} video mới nhất cho profile Douyin...`,
        profile_id: Number(profile.id),
        already_exists: true,
      };
    }

    // Profile mới → cào đồng bộ lô đầu (await) để trả dữ liệu ngay, phần còn lại chạy nền
    const firstBatch = Math.min(20, targetCount);
    const result = await this.scrapeProfileVideos(profile.id, firstBatch);
    if (result.videos_returned === 0) {
      await this.prisma.scraperDouyinProfile.delete({ where: { id: profile.id } }).catch(() => {});
      throw new HttpException({ error: 'Không tìm thấy video cho sec_user_id này' }, HttpStatus.NOT_FOUND);
    }

    // Dispatch cào tiếp tới tổng targetCount video (fire-and-forget)
    const continuationNeeded = targetCount > firstBatch;
    if (continuationNeeded) {
      this.scrapeProfileVideos(profile.id, targetCount).catch((err) => {
        this.logger.error(`[DOUYIN-PROFILE] ${secUserId} continuation thất bại: ${err.message}`);
      });
    }

    const updatedProfile = await this.prisma.scraperDouyinProfile.findUniqueOrThrow({ where: { id: profile.id } });
    const label = updatedProfile.username || secUserId.slice(0, 20);

    const batchInfo = `${result.videos_returned} posts (${result.created} mới)`;
    return {
      status: 'ok',
      message: continuationNeeded
        ? `Đã cào ${batchInfo} cho @${label}. Đang cào tiếp tới ${targetCount}...`
        : `Đã cào ${batchInfo} cho @${label}.`,
      profile_id: Number(updatedProfile.id),
      newly_scraped: true,
      profile: {
        id: Number(updatedProfile.id),
        sec_user_id: updatedProfile.sec_user_id,
        username: updatedProfile.username,
        nickname: updatedProfile.nickname || '',
        avatar_url: updatedProfile.avatar_url || '',
        biography: updatedProfile.biography || '',
        is_verified: updatedProfile.is_verified,
        followers_count: Number(updatedProfile.followers_count),
        scraping_status: updatedProfile.scraping_status,
      },
      initial_posts_count: result.created,
    };
  }

  // ─── Toggle bookmark/tracked ─────────────────────────────────────────────

  async toggleProfile(id: bigint, field: 'is_bookmarked' | 'is_tracked'): Promise<boolean> {
    const profile = await this.prisma.scraperDouyinProfile.findUnique({ where: { id } });
    if (!profile) throw new HttpException({ error: 'Not found' }, HttpStatus.NOT_FOUND);
    const newValue = !profile[field];
    await this.prisma.scraperDouyinProfile.update({ where: { id }, data: { [field]: newValue } });
    return newValue;
  }

  // ─── Xoá cứng kênh ──────────────────────────────────────────────────────────

  // Douyin là nền tảng duy nhất KHÔNG có khoá ngoại từ video sang profile: video nằm
  // trong kho dùng chung, nối với kênh bằng chuỗi search_keyword = '@' + username do
  // scrapeProfileVideos ghi vào. Hệ quả cần biết: video nào lần đầu vào kho qua tìm kiếm
  // từ khoá sẽ giữ từ khoá đó (upsertVideo ưu tiên search_keyword cũ), nên dù sau này
  // xuất hiện trong lần cào kênh thì vẫn KHÔNG bị xoá theo kênh.
  async deleteProfile(id: bigint): Promise<DeleteChannelResult> {
    const profile = await this.prisma.scraperDouyinProfile.findUnique({ where: { id } });
    if (!profile) throw new HttpException({ error: 'Không tìm thấy kênh' }, HttpStatus.NOT_FOUND);

    // Chưa có username thì '@' + '' = '@' — đem đi deleteMany sẽ quét bừa sang kênh khác.
    let videosDeleted = 0;
    if (profile.username) {
      const { count } = await this.prisma.scraperDouyinVideo.deleteMany({
        where: { search_keyword: `@${profile.username}` },
      });
      videosDeleted = count;
    }
    await this.prisma.scraperDouyinProfile.delete({ where: { id } });

    const name = profile.nickname || profile.username || profile.sec_user_id;
    this.logger.warn(`[DOUYIN] Đã xoá cứng kênh "${name}" (id=${id}) kèm ${videosDeleted} video.`);
    return buildDeleteChannelResult(id, name, videosDeleted);
  }

  // Tự mở khóa profile bị kẹt ở 'processing' quá lâu (worker crash giữa chừng), tránh
  // bị loại khỏi cron định kỳ vĩnh viễn — khớp pattern _reset_stale_locks() của Facebook.
  private async resetStaleLocks(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000);
    const result = await this.prisma.scraperDouyinProfile.updateMany({
      where: { scraping_status: 'processing', updated_at: { lt: cutoff } },
      data: { scraping_status: 'idle' },
    });
    if (result.count > 0) {
      this.logger.warn(`⚠️ Reset ${result.count} profile Douyin bị stuck lock`);
    }
  }

  // ─── Periodic: cào video mới cho profile is_tracked=true (cron) ─────────
  // is_tracked là tiêu chí chọn lọc duy nhất; scraping_status chỉ dùng để loại trừ
  // profile đang cào dở (!= 'processing'), không so khớp cứng 1 giá trị cụ thể.

  // ─── Auto re-run từ khoá đã search nhiều nhất (cron riêng, khác giờ periodicRefresh) ──
  private static readonly MAX_AUTO_RERUN_KEYWORDS_PER_CRON = 3;
  private static readonly MIN_HIT_COUNT_FOR_AUTO_RERUN = 3;

  async autoRerunTopKeywords(): Promise<{ keywords: string[]; created: number; updated: number }> {
    const { suggestions } = await this.readService.keywordSuggest('');
    const keywords = suggestions
      .filter((s) => s.count >= DouyinScraperService.MIN_HIT_COUNT_FOR_AUTO_RERUN)
      .slice(0, DouyinScraperService.MAX_AUTO_RERUN_KEYWORDS_PER_CRON)
      .map((s) => s.keyword);

    let created = 0;
    let updated = 0;
    for (const keyword of keywords) {
      try {
        // Từ khoá lưu trong DB là TIẾNG VIỆT (user gõ) — Douyin chỉ ra kết quả tốt với
        // tiếng Trung, nên phải dịch lại trước khi query. Hàm dịch tự bỏ qua nếu từ khoá
        // vốn đã là tiếng Trung, và fail-open trả lại nguyên văn nếu AI service chết.
        const { translated } = await this.aiIntegration.translateSearchKeyword(keyword);
        // Giữ nguyên tiếng Việt khi lưu lại, để lần rerun sau vẫn đọc được.
        const r = await this.searchKeyword(translated, 30, keyword);
        created += r.created;
        updated += r.updated;
      } catch (err: any) {
        this.logger.error(`[DOUYIN-AUTO-RERUN] '${keyword}' thất bại: ${err.message}`);
      }
    }

    this.logger.log(`[DOUYIN-AUTO-RERUN] Rerun ${keywords.length} từ khoá: ${keywords.join(', ') || '(không có)'}`);
    return { keywords, created, updated };
  }

  async periodicRefresh(): Promise<{ total: number; done: number; failed: number }> {
    await this.resetStaleLocks();

    const profiles = await this.prisma.scraperDouyinProfile.findMany({
      where: { is_tracked: true, is_initial_scraped: true, scraping_status: { not: 'processing' } },
      orderBy: { last_scraped_at: 'asc' },
    });

    if (profiles.length === 0) {
      this.logger.log('[DOUYIN-PERIODIC] Không có profile nào cần cào định kỳ.');
      return { total: 0, done: 0, failed: 0 };
    }

    this.logger.log(`═══ [DOUYIN-PERIODIC] Cào video mới cho ${profiles.length} profile(s) ═══`);
    let done = 0;
    let failed = 0;

    for (const profile of profiles) {
      try {
        await this.scrapeProfileVideos(profile.id, 10);
        done++;
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ @${profile.username || profile.sec_user_id}: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    this.logger.log(`═══ [DOUYIN-PERIODIC] Xong: ${done}/${profiles.length} OK, ${failed} lỗi ═══`);
    return { total: profiles.length, done, failed };
  }
}
