import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../task-auto/notifications/notifications.service';
import { DEFAULT_TARGET_COUNT } from '../../common/utils/target-count.util';
import {
  TiktokAiClientService,
  ParsedTikTokVideo,
  ParsedTikTokProfileVideo,
  ParsedTikTokAuthor,
} from './tiktok-ai-client.service';
import { TiktokScraperReadService } from './tiktok-scraper-read.service';
import { DeleteChannelResult, buildDeleteChannelResult } from '../../common/utils/delete-channel.util';
import { isHostedThumbnailUrl } from '../../common/utils/hosted-thumbnail-url.util';


const STALE_LOCK_MINUTES = 30;

// Toàn bộ logic ghi DB port từ AI (tikhub_tiktok.py::ingest_tikhub_videos +
// tikhub_tiktok_profile.py::upsert_profile_from_author/ingest_tikhub_profile_posts đã xóa +
// scraper_views.py::tiktok_search/tiktok_profile_scrape/tiktok_profile_toggle +
// tasks.py::search_tiktok_keyword_task/scrape_tiktok_profile_posts_task/periodic_scrape_tiktok_profiles_task).
// AI giờ chỉ fetch + parse (tiktok_fetch_views.py), BE là nơi duy nhất ghi
// scraper_tiktok_videos / scraper_tiktok_profiles / scraper_tiktok_profile_videos.
@Injectable()
export class TiktokScraperService {
  private readonly logger = new Logger(TiktokScraperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: TiktokAiClientService,
    private readonly notifications: NotificationsService,
    private readonly readService: TiktokScraperReadService,
  ) {}

  // ─── Growth Alert: snapshot followers + báo động nếu tăng đột biến ────────
  // Chỉ gọi từ task đầy đủ (scrapeProfilePosts), KHÔNG gọi từ ingestProfilePostsSync
  // (batch nhanh 20 đầu) — tránh 2 lần snapshot cho cùng 1 lần cào profile mới.
  private static readonly GROWTH_ALERT_THRESHOLD_PCT = 0.2;

  private async recordMetricsAndMaybeAlert(profileId: bigint, profileName: string): Promise<void> {
    const fresh = await this.prisma.scraperTikTokProfile.findUniqueOrThrow({ where: { id: profileId } });
    const previous = await this.prisma.scraperTikTokProfileMetrics.findFirst({
      where: { profile_id: profileId },
      orderBy: { captured_at: 'desc' },
    });

    await this.prisma.scraperTikTokProfileMetrics.create({
      data: {
        profile_id: profileId,
        followers_count: fresh.followers_count,
        following_count: fresh.following_count,
        likes_count: fresh.likes_count,
      },
    });

    if (!previous || previous.followers_count <= 0n) return;
    const growth = Number(fresh.followers_count - previous.followers_count) / Number(previous.followers_count);
    if (growth < TiktokScraperService.GROWTH_ALERT_THRESHOLD_PCT) return;

    const pct = Math.round(growth * 100);
    await this.notifications.broadcastToActiveUsers(
      'GROWTH_ALERT',
      `Kênh TikTok @${profileName} tăng trưởng đột biến`,
      `Followers tăng ${pct}% (${previous.followers_count} → ${fresh.followers_count}) kể từ lần cào trước.`,
      { platform: 'tiktok', profile_id: Number(profileId) },
    );
  }

  // ─── Keyword search ────────────────────────────────────────────────────────

  private async upsertVideo(v: ParsedTikTokVideo): Promise<{ created: boolean }> {
    const existing = await this.prisma.scraperTikTokVideo.findUnique({ where: { post_id: v.post_id } });

    const preview_image = existing && isHostedThumbnailUrl(existing.preview_image) ? existing.preview_image : v.thumbnail_url;
    const search_keyword = existing?.search_keyword || v.search_keyword || '';

    const data = {
      shortcode: v.shortcode,
      url: v.url,
      description: v.description,
      hashtags: v.hashtags,
      video_url: '',
      cdn_url: '',
      preview_image,
      video_duration: v.video_duration,
      region: v.region,
      author_id: v.author_id,
      author_username: v.author_username,
      author_display_name: v.author_display_name,
      author_avatar: v.author_avatar,
      author_url: v.author_url,
      author_followers: BigInt(v.author_followers || 0),
      author_is_verified: v.author_is_verified,
      play_count: BigInt(v.play_count || 0),
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
      await this.prisma.scraperTikTokVideo.update({ where: { post_id: v.post_id }, data });
      return { created: false };
    }
    await this.prisma.scraperTikTokVideo.create({ data: { ...data, post_id: v.post_id } });
    return { created: true };
  }

  // Dedup (post_id đã có trong DB) làm giảm số video MỚI thực sự ingest được so
  // với `count` yêu cầu — TikHub tự trả đủ `count` item thô mỗi lần gọi, nhưng
  // nhiều item trong đó có thể trùng với video đã cào trước (cùng keyword tìm
  // lại thấy top result cũ). Vòng lặp dưới đây gọi tiếp AI với cursor nối tiếp
  // (không lặp lại từ đầu) để bù phần bị trùng, tối đa MAX_ROUNDS lần.
  private static readonly MAX_SEARCH_ROUNDS = 5;

  // ─── Auto-discover kênh mới từ tác giả xuất hiện trong kết quả search ──────
  // Chỉ xét top N tác giả theo followers (ranking signal duy nhất TikTok có sẵn
  // trong search-video), lọc floor để tránh cào profile "rác" (tài khoản nhỏ,
  // ít giá trị). is_tracked mặc định false (scrapeProfile() không set khi
  // create) — giống hệt hành vi thêm profile thủ công, tránh cron phình to +
  // tránh chi phí TikHub tăng dần không kiểm soát.
  private static readonly MAX_AUTO_DISCOVER_PER_SEARCH = 5;
  private static readonly MIN_AUTO_DISCOVER_FOLLOWERS = 5000;

  private async autoDiscoverNewAuthors(candidates: Map<string, number>): Promise<string[]> {
    const ranked = Array.from(candidates.entries())
      .filter(([, followers]) => followers >= TiktokScraperService.MIN_AUTO_DISCOVER_FOLLOWERS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TiktokScraperService.MAX_AUTO_DISCOVER_PER_SEARCH)
      .map(([username]) => username);

    if (ranked.length === 0) return [];

    const existing = await this.prisma.scraperTikTokProfile.findMany({
      where: { username: { in: ranked } },
      select: { username: true },
    });
    const existingSet = new Set(existing.map((p) => p.username));
    const newUsernames = ranked.filter((u) => !existingSet.has(u));

    for (const username of newUsernames) {
      this.scrapeProfile(username).catch((err) => {
        this.logger.error(`[TT-AUTO-DISCOVER] @${username} thất bại: ${err.message}`);
      });
    }

    if (newUsernames.length > 0) {
      this.logger.log(`[TT-AUTO-DISCOVER] Phát hiện + dispatch cào ${newUsernames.length} kênh mới: ${newUsernames.join(', ')}`);
    }
    return newUsernames;
  }

  async searchKeyword(keyword: string, count = 30, region = 'VN'): Promise<{ created: number; updated: number; auto_discovered: string[] }> {
    let created = 0;
    let updated = 0;
    let cursor = 0;
    let hasMore = true;
    let round = 0;
    const authorCandidates = new Map<string, number>();

    for (; round < TiktokScraperService.MAX_SEARCH_ROUNDS && created < count && hasMore; round++) {
      const remaining = count - created;
      const { videos, cursor: nextCursor, has_more } = await this.aiClient.fetchSearch(keyword, remaining, region, cursor);
      if (videos.length === 0) break;

      for (const v of videos) {
        const r = await this.upsertVideo(v);
        if (r.created) created++;
        else updated++;

        if (v.author_username) {
          const prevMax = authorCandidates.get(v.author_username) ?? 0;
          authorCandidates.set(v.author_username, Math.max(prevMax, v.author_followers ?? 0));
        }
      }

      cursor = nextCursor;
      hasMore = has_more;
    }

    // Log rõ lý do dừng để phân biệt "TikHub hết kết quả thật" (hasMore=false) vs
    // "chạm giới hạn an toàn MAX_SEARCH_ROUNDS trong khi vẫn còn trang" (hasMore=true).
    const stopReason = created >= count ? 'đủ count' : hasMore ? 'chạm MAX_SEARCH_ROUNDS' : 'TikHub hết kết quả (has_more=false)';
    this.logger.log(`[TIKTOK] Ingest '${keyword}': +${created}/${count} new, ~${updated} updated, ${round} round(s), dừng vì: ${stopReason}`);

    const auto_discovered = await this.autoDiscoverNewAuthors(authorCandidates);
    return { created, updated, auto_discovered };
  }

  // ─── Profile: helpers ──────────────────────────────────────────────────────

  private async upsertProfileVideo(profileId: bigint, v: ParsedTikTokProfileVideo): Promise<{ created: boolean }> {
    const existing = await this.prisma.scraperTikTokProfileVideo.findUnique({ where: { video_id: v.video_id } });
    const cover_image = existing && isHostedThumbnailUrl(existing.cover_image) ? existing.cover_image : v.thumbnail_url;

    const data = {
      profile_id: profileId,
      shortcode: v.shortcode,
      url: v.url,
      description: v.description,
      hashtags: v.hashtags,
      cover_image,
      video_duration: v.video_duration,
      region: v.region,
      post_type: v.post_type,
      play_count: BigInt(v.play_count || 0),
      digg_count: BigInt(v.digg_count || 0),
      comment_count: BigInt(v.comment_count || 0),
      share_count: BigInt(v.share_count || 0),
      favorites_count: BigInt(v.favorites_count || 0),
      music_title: v.music_title,
      music_author: v.music_author,
      date_posted: new Date(v.date_posted),
    };

    if (existing) {
      await this.prisma.scraperTikTokProfileVideo.update({ where: { video_id: v.video_id }, data });
      return { created: false };
    }
    await this.prisma.scraperTikTokProfileVideo.create({ data: { ...data, video_id: v.video_id } });
    return { created: true };
  }

  // Khớp upsert_profile_from_author cũ — ghi đè toàn bộ field không điều kiện,
  // chỉ profile_id là giữ nguyên nếu đã có sẵn.
  private async applyAuthorUpdate(
    profileId: bigint,
    existingProfileIdField: string,
    author: ParsedTikTokAuthor,
  ): Promise<void> {
    const data: any = {
      sec_uid: author.sec_uid,
      nickname: author.nickname,
      url: author.url,
      avatar_url: author.avatar_url,
      biography: author.biography,
      is_verified: author.is_verified,
      followers_count: BigInt(author.followers_count || 0),
      following_count: BigInt(author.following_count || 0),
      videos_count: author.videos_count,
    };
    if (author.profile_id && !existingProfileIdField) {
      data.profile_id = author.profile_id;
    }
    await this.prisma.scraperTikTokProfile.update({ where: { id: profileId }, data });
  }

  // Batch đầu SYNCHRONOUS (~20 posts) — chỉ fetch + upsert, KHÔNG đổi scraping_status
  // (khớp ingest_tikhub_profile_posts cũ: status vẫn là 'processing' do view set trước đó).
  private async ingestProfilePostsSync(
    profile: { id: bigint; username: string; sec_uid: string; profile_id: string },
    count: number,
  ): Promise<{ created: number; updated: number; items_returned: number }> {
    const { author, videos } = await this.aiClient.fetchProfilePosts({
      username: profile.username,
      secUid: profile.sec_uid,
      count,
    });
    if (videos.length === 0) return { created: 0, updated: 0, items_returned: 0 };

    if (author) await this.applyAuthorUpdate(profile.id, profile.profile_id, author);

    let created = 0;
    let updated = 0;
    for (const v of videos) {
      const r = await this.upsertProfileVideo(profile.id, v);
      if (r.created) created++;
      else updated++;
    }
    return { created, updated, items_returned: videos.length };
  }

  // Task đầy đủ — quản lý scraping_status lifecycle (processing → completed/idle/failed).
  // Dùng cho: cào tiếp nền (count=600), delta scrape (days), cron định kỳ.
  // Lưu ý: khớp code gốc, tự quyết định fetch theo count (lần đầu) hay theo days (đã từng cào).
  async scrapeProfilePosts(profileId: bigint, options: { count?: number; days?: number } = {}): Promise<{
    created: number;
    updated: number;
    items_returned: number;
  }> {
    const profile = await this.prisma.scraperTikTokProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new Error(`Profile ${profileId} không tồn tại`);

    if (profile.scraping_status !== 'processing') {
      await this.prisma.scraperTikTokProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'processing', scrape_error: null },
      });
    }

    try {
      const wasInitialScraped = profile.is_initial_scraped;
      let author: ParsedTikTokAuthor | null;
      let videos: ParsedTikTokProfileVideo[];

      if (wasInitialScraped) {
        const fetchDays = options.days && options.days > 0 ? options.days : 7;
        ({ author, videos } = await this.aiClient.fetchProfilePosts({
          username: profile.username,
          secUid: profile.sec_uid,
          days: fetchDays,
        }));
      } else {
        const count = options.count ?? 50;
        ({ author, videos } = await this.aiClient.fetchProfilePosts({
          username: profile.username,
          secUid: profile.sec_uid,
          count,
        }));
      }

      if (videos.length === 0) {
        await this.prisma.scraperTikTokProfile.update({
          where: { id: profileId },
          data: {
            scraping_status: 'idle',
            scrape_error: 'TikHub không trả về posts (profile không có video hoặc username không tồn tại)',
          },
        });
        return { created: 0, updated: 0, items_returned: 0 };
      }

      if (!wasInitialScraped) {
        await this.prisma.scraperTikTokProfile.update({ where: { id: profileId }, data: { is_initial_scraped: true } });
      }

      if (author) await this.applyAuthorUpdate(profileId, profile.profile_id, author);

      let created = 0;
      let updated = 0;
      for (const v of videos) {
        const r = await this.upsertProfileVideo(profileId, v);
        if (r.created) created++;
        else updated++;
      }

      await this.prisma.scraperTikTokProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'completed', scrape_error: null, last_scraped_at: new Date() },
      });

      this.recordMetricsAndMaybeAlert(profileId, profile.username).catch((err) => {
        this.logger.error(`[TT-GROWTH-ALERT] ${profile.username}: ${err.message}`);
      });

      this.logger.log(`[TT-PROFILE] @${profile.username}: +${created} mới, ~${updated} cập nhật`);
      return { created, updated, items_returned: videos.length };
    } catch (err: any) {
      await this.prisma.scraperTikTokProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'failed', scrape_error: (err.message || '').slice(0, 500) },
      });
      throw err;
    }
  }

  async scrapeProfile(username: string, isOwned?: boolean, targetCount = DEFAULT_TARGET_COUNT): Promise<any> {
    let profile = await this.prisma.scraperTikTokProfile.findUnique({ where: { username } });
    const wasCreated = !profile;
    if (!profile) {
      profile = await this.prisma.scraperTikTokProfile.create({
        data: {
          profile_id: '',
          username,
          url: `https://www.tiktok.com/@${username}`,
          nickname: '',
          is_owned: !!isOwned,
        },
      });
    }

    if (profile.scraping_status === 'processing') {
      return {
        status: 'ok',
        message: `@${username} đang được cào.`,
        is_scraping: true,
        profile_id: Number(profile.id),
      };
    }

    const needsDeltaScrape = !wasCreated && profile.is_initial_scraped;
    const updateData: any = { scraping_status: 'processing', scrape_error: null };
    if (isOwned && !profile.is_owned) updateData.is_owned = true;
    await this.prisma.scraperTikTokProfile.update({ where: { id: profile.id }, data: updateData });

    // Profile đã cào lần đầu rồi → chỉ cào delta (7 ngày gần nhất), dispatch nền
    if (needsDeltaScrape) {
      this.scrapeProfilePosts(profile.id, { days: 7 }).catch((err) => {
        this.logger.error(`[TT-PROFILE] ${username} thất bại: ${err.message}`);
      });
      return {
        status: 'ok',
        message: `Đang cập nhật video mới cho @${username}...`,
        already_exists: true,
        profile_id: Number(profile.id),
      };
    }

    // Batch đầu SYNCHRONOUS (nhỏ, rất nhanh) — trả data ngay cho user, phần còn lại chạy nền
    const firstBatch = Math.min(20, targetCount);
    const freshProfile = await this.prisma.scraperTikTokProfile.findUniqueOrThrow({ where: { id: profile.id } });
    const result = await this.ingestProfilePostsSync(freshProfile, firstBatch);

    if (result.items_returned === 0) {
      if (wasCreated) {
        await this.prisma.scraperTikTokProfile.delete({ where: { id: profile.id } }).catch(() => {});
      } else {
        await this.prisma.scraperTikTokProfile.update({
          where: { id: profile.id },
          data: { scraping_status: 'idle', scrape_error: 'TikHub không trả về posts (profile không có video hoặc username không tồn tại)' },
        });
      }
      throw new HttpException({ error: 'Không tìm thấy posts cho username này' }, HttpStatus.NOT_FOUND);
    }

    // Dispatch cào tiếp tới tổng targetCount posts (fire-and-forget) — tự set scraping_status='completed'
    const continuationNeeded = targetCount > firstBatch;
    if (continuationNeeded) {
      this.scrapeProfilePosts(profile.id, { count: targetCount }).catch((err) => {
        this.logger.error(`[TT-PROFILE] ${username} continuation thất bại: ${err.message}`);
      });
    } else {
      // Không có phần chạy nền → tự chốt trạng thái, tránh kẹt 'processing'.
      await this.prisma.scraperTikTokProfile.update({
        where: { id: profile.id },
        data: {
          scraping_status: 'completed',
          scrape_error: null,
          is_initial_scraped: true,
          last_scraped_at: new Date(),
        },
      });
    }

    const updated = await this.prisma.scraperTikTokProfile.findUniqueOrThrow({ where: { id: profile.id } });

    const batchInfo = `${result.items_returned} posts (${result.created} mới)`;
    return {
      status: 'ok',
      message: continuationNeeded
        ? `Đã cào ${batchInfo} cho @${username}. Đang cào tiếp tới ${targetCount}...`
        : `Đã cào ${batchInfo} cho @${username}.`,
      profile_id: Number(updated.id),
      newly_scraped: true,
      profile: {
        id: Number(updated.id),
        username: updated.username,
        nickname: updated.nickname || '',
        avatar_url: updated.avatar_url || '',
        biography: updated.biography || '',
        is_verified: updated.is_verified,
        followers_count: Number(updated.followers_count),
        following_count: Number(updated.following_count),
        likes_count: Number(updated.likes_count),
        videos_count: updated.videos_count,
        scraping_status: updated.scraping_status,
      },
      initial_posts_count: result.created,
    };
  }

  // ─── Toggle bookmark/tracked ─────────────────────────────────────────────

  async toggleProfile(id: bigint, field: 'is_bookmarked' | 'is_tracked'): Promise<boolean> {
    const profile = await this.prisma.scraperTikTokProfile.findUnique({ where: { id } });
    if (!profile) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    const newValue = !profile[field];
    await this.prisma.scraperTikTokProfile.update({ where: { id }, data: { [field]: newValue } });
    return newValue;
  }

  // ─── Xoá cứng kênh ──────────────────────────────────────────────────────────

  // Video/metrics gắn khoá ngoại onDelete Cascade nên Postgres tự dọn bảng con.
  // Phải ĐẾM TRƯỚC khi xoá: đếm sau thì cascade đã quét sạch và con số báo về luôn là 0,
  // trong khi FE dùng đúng con số này để nói người dùng vừa mất bao nhiêu video.
  async deleteProfile(id: bigint): Promise<DeleteChannelResult> {
    const profile = await this.prisma.scraperTikTokProfile.findUnique({ where: { id } });
    if (!profile) throw new HttpException({ error: 'Không tìm thấy kênh' }, HttpStatus.NOT_FOUND);

    const videosDeleted = await this.prisma.scraperTikTokProfileVideo.count({ where: { profile_id: id } });
    await this.prisma.scraperTikTokProfile.delete({ where: { id } });

    const name = profile.nickname || profile.username;
    this.logger.warn(`[TIKTOK] Đã xoá cứng kênh "${name}" (id=${id}) kèm ${videosDeleted} video.`);
    return buildDeleteChannelResult(id, name, videosDeleted);
  }

  // Tự mở khóa profile bị kẹt ở 'processing' quá lâu (worker crash giữa chừng), tránh
  // bị loại khỏi cron định kỳ vĩnh viễn — khớp pattern _reset_stale_locks() của Facebook.
  private async resetStaleLocks(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000);
    const result = await this.prisma.scraperTikTokProfile.updateMany({
      where: { scraping_status: 'processing', updated_at: { lt: cutoff } },
      data: { scraping_status: 'idle' },
    });
    if (result.count > 0) {
      this.logger.warn(`⚠️ Reset ${result.count} profile TikTok bị stuck lock`);
    }
  }

  // ─── Periodic: cào posts mới cho profile is_tracked=true (cron) ─────────
  // is_tracked là tiêu chí chọn lọc duy nhất; scraping_status chỉ dùng để loại trừ
  // profile đang cào dở (!= 'processing'), không so khớp cứng 1 giá trị cụ thể.
  // (Đã sửa so với code gốc: code gốc lọc scraping_status='idle' nhưng task lại set
  // 'completed' khi xong, khiến profile chỉ được cron chọn đúng 1 lần rồi thôi.)

  // ─── Auto re-run từ khoá đã search nhiều nhất (cron riêng, khác giờ periodicRefresh) ──
  // Tái dùng nguyên searchKeyword() thủ công đang dùng cho POST /search — tự động
  // kế thừa MAX_SEARCH_ROUNDS + auto-discover kênh mới, không viết logic ingest mới.
  // Floor MIN_HIT_COUNT tránh rerun từ khoá chỉ tìm 1 lần rồi bỏ; cap
  // MAX_KEYWORDS_PER_CRON kiểm soát chi phí TikHub dồn từ auto-discover bên trong.
  private static readonly MAX_AUTO_RERUN_KEYWORDS_PER_CRON = 3;
  private static readonly MIN_HIT_COUNT_FOR_AUTO_RERUN = 3;

  async autoRerunTopKeywords(): Promise<{ keywords: string[]; created: number; updated: number }> {
    const { suggestions } = await this.readService.keywordSuggest('');
    const keywords = suggestions
      .filter((s) => s.count >= TiktokScraperService.MIN_HIT_COUNT_FOR_AUTO_RERUN)
      .slice(0, TiktokScraperService.MAX_AUTO_RERUN_KEYWORDS_PER_CRON)
      .map((s) => s.keyword);

    let created = 0;
    let updated = 0;
    for (const keyword of keywords) {
      try {
        const r = await this.searchKeyword(keyword);
        created += r.created;
        updated += r.updated;
      } catch (err: any) {
        this.logger.error(`[TT-AUTO-RERUN] '${keyword}' thất bại: ${err.message}`);
      }
    }

    this.logger.log(`[TT-AUTO-RERUN] Rerun ${keywords.length} từ khoá: ${keywords.join(', ') || '(không có)'}`);
    return { keywords, created, updated };
  }

  async periodicRefresh(): Promise<{ total: number; done: number; failed: number }> {
    await this.resetStaleLocks();

    const profiles = await this.prisma.scraperTikTokProfile.findMany({
      where: { is_tracked: true, is_initial_scraped: true, scraping_status: { not: 'processing' } },
      orderBy: { last_scraped_at: 'asc' },
    });

    if (profiles.length === 0) {
      this.logger.log('[TT-PERIODIC] Không có profile nào cần cào định kỳ.');
      return { total: 0, done: 0, failed: 0 };
    }

    this.logger.log(`═══ [TT-PERIODIC] Cào posts mới cho ${profiles.length} profile(s) ═══`);
    let done = 0;
    let failed = 0;

    for (const profile of profiles) {
      try {
        await this.scrapeProfilePosts(profile.id, { days: 7 });
        done++;
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ @${profile.username}: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    this.logger.log(`═══ [TT-PERIODIC] Xong: ${done}/${profiles.length} OK, ${failed} lỗi ═══`);
    return { total: profiles.length, done, failed };
  }
}
