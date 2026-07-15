import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  KuaishouAiClientService, ParsedKuaishouProfile, ParsedKuaishouVideo, ParsedKuaishouSearchVideo,
} from './kuaishou-ai-client.service';

const STALE_LOCK_MINUTES = 30;

// Nền tảng mới — chỉ có kênh ngoài (external), không có is_owned. BE sở hữu DB
// hoàn toàn từ đầu (không có code AI cũ để migrate). AI chỉ fetch + parse
// (kuaishou_fetch_views.py), BE là nơi duy nhất ghi scraper_kuaishou_profiles /
// scraper_kuaishou_videos / scraper_kuaishou_search_videos. Mirror pattern
// TikTok/YouTube (sync 20 trả ngay + cào nền tới 300, is_tracked-based
// periodic, resetStaleLocks).
@Injectable()
export class KuaishouScraperService {
  private readonly logger = new Logger(KuaishouScraperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: KuaishouAiClientService,
  ) {}

  // ─── Keyword search ────────────────────────────────────────────────────────

  private async upsertSearchVideo(v: ParsedKuaishouSearchVideo): Promise<{ created: boolean }> {
    const existing = await this.prisma.scraperKuaishouSearchVideo.findUnique({ where: { post_id: v.post_id } });
    const search_keyword = existing?.search_keyword || v.search_keyword || '';

    const data = {
      url: v.url,
      description: v.description,
      hashtags: v.hashtags,
      thumbnail_url: v.thumbnail_url,
      video_duration: v.video_duration,
      author_id: v.author_id,
      author_eid: v.author_eid,
      author_username: v.author_username,
      author_avatar: v.author_avatar,
      author_is_verified: v.author_is_verified,
      view_count: BigInt(v.view_count || 0),
      like_count: BigInt(v.like_count || 0),
      comment_count: BigInt(v.comment_count || 0),
      share_count: BigInt(v.share_count || 0),
      collect_count: BigInt(v.collect_count || 0),
      search_keyword,
      date_posted: new Date(v.date_posted),
    };

    if (existing) {
      await this.prisma.scraperKuaishouSearchVideo.update({ where: { post_id: v.post_id }, data });
      return { created: false };
    }
    await this.prisma.scraperKuaishouSearchVideo.create({ data: { ...data, post_id: v.post_id } });
    return { created: true };
  }

  // Dedup (post_id đã có trong DB) làm giảm số video MỚI thực sự ingest được so
  // với `count` yêu cầu — vòng lặp dưới đây gọi tiếp AI với cursor nối tiếp
  // (không lặp lại từ đầu) để bù phần bị trùng, tối đa MAX_SEARCH_ROUNDS lần.
  private static readonly MAX_SEARCH_ROUNDS = 5;

  async searchKeyword(keyword: string, count = 30): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    let cursor: string | null | undefined = undefined;
    let hasMore = true;

    for (let round = 0; round < KuaishouScraperService.MAX_SEARCH_ROUNDS && created < count && hasMore; round++) {
      const remaining = count - created;
      const { videos, cursor: nextCursor, has_more } = await this.aiClient.fetchSearch(keyword, remaining, cursor);
      if (videos.length === 0) break;

      for (const v of videos) {
        const r = await this.upsertSearchVideo(v);
        if (r.created) created++;
        else updated++;
      }

      cursor = nextCursor;
      hasMore = has_more;
    }

    this.logger.log(`[KUAISHOU-SEARCH] Ingest '${keyword}': +${created} new, ~${updated} updated`);
    return { created, updated };
  }

  private async upsertVideo(profileId: bigint, v: ParsedKuaishouVideo): Promise<{ created: boolean }> {
    const existing = await this.prisma.scraperKuaishouVideo.findUnique({ where: { post_id: v.post_id } });
    const data = {
      profile_id: profileId,
      url: v.url,
      description: v.description,
      hashtags: v.hashtags,
      thumbnail_url: v.thumbnail_url,
      video_duration: v.video_duration,
      view_count: BigInt(v.view_count || 0),
      like_count: BigInt(v.like_count || 0),
      comment_count: BigInt(v.comment_count || 0),
      share_count: BigInt(v.share_count || 0),
      collect_count: BigInt(v.collect_count || 0),
      date_posted: new Date(v.date_posted),
    };

    if (existing) {
      await this.prisma.scraperKuaishouVideo.update({ where: { post_id: v.post_id }, data });
      return { created: false };
    }
    await this.prisma.scraperKuaishouVideo.create({ data: { ...data, post_id: v.post_id } });
    return { created: true };
  }

  // Ghi đè toàn bộ field không điều kiện — fetch_one_user_v2 luôn trả full info
  // mới nhất. Bao gồm cả user_id (numeric) — lần đầu là RESOLVE (từ null),
  // các lần sau là ghi đè (không đổi giá trị vì cùng 1 tài khoản).
  private async applyProfileUpdate(profileId: bigint, profile: ParsedKuaishouProfile): Promise<void> {
    await this.prisma.scraperKuaishouProfile.update({
      where: { id: profileId },
      data: {
        user_id: profile.user_id,
        username: profile.username,
        nickname: profile.nickname,
        url: profile.url,
        avatar_url: profile.avatar_url,
        biography: profile.biography,
        gender: profile.gender,
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
    profile: { id: bigint; eid: string },
    count: number,
  ): Promise<{ created: number; updated: number; items_returned: number }> {
    const { profile_api_ok, profile: parsedProfile, videos } = await this.aiClient.fetchProfile(profile.eid, count);

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
    const profile = await this.prisma.scraperKuaishouProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new Error(`Profile ${profileId} không tồn tại`);

    if (profile.scraping_status !== 'processing') {
      await this.prisma.scraperKuaishouProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'processing', scrape_error: null },
      });
    }

    try {
      const { profile_api_ok, profile: parsedProfile, videos } = await this.aiClient.fetchProfile(profile.eid, numOfPosts);

      if (!profile_api_ok) {
        await this.prisma.scraperKuaishouProfile.update({
          where: { id: profileId },
          data: { scraping_status: 'failed', scrape_error: 'Không lấy được thông tin profile từ API' },
        });
        throw new Error('Không lấy được thông tin profile từ API');
      }

      if (videos.length === 0) {
        await this.prisma.scraperKuaishouProfile.update({
          where: { id: profileId },
          data: { scraping_status: 'idle', scrape_error: 'Không có video nào được trả về' },
        });
        return { created: 0, updated: 0, items_returned: 0 };
      }

      if (parsedProfile) await this.applyProfileUpdate(profileId, parsedProfile);

      if (!profile.is_initial_scraped) {
        await this.prisma.scraperKuaishouProfile.update({ where: { id: profileId }, data: { is_initial_scraped: true } });
      }

      let created = 0;
      let updated = 0;
      for (const v of videos) {
        const r = await this.upsertVideo(profileId, v);
        if (r.created) created++;
        else updated++;
      }

      await this.prisma.scraperKuaishouProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'completed', scrape_error: null, last_scraped_at: new Date() },
      });

      this.logger.log(`[KUAISHOU-PROFILE] ${profile.nickname || profile.eid}: +${created} mới, ~${updated} cập nhật`);
      return { created, updated, items_returned: videos.length };
    } catch (err: any) {
      await this.prisma.scraperKuaishouProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'failed', scrape_error: (err.message || '').slice(0, 500) },
      });
      throw err;
    }
  }

  // eid — định danh trong URL profile — là input duy nhất để thêm/tra cứu
  // channel. Numeric user_id (cần cho fetch_user_hot_post) được resolve bên
  // trong ingestVideosSync/scrapeProfileVideos, không cần biết trước ở đây.
  async scrapeProfile(eid: string): Promise<any> {
    let profile = await this.prisma.scraperKuaishouProfile.findUnique({ where: { eid } });
    const wasCreated = !profile;
    if (!profile) {
      profile = await this.prisma.scraperKuaishouProfile.create({
        data: { eid, url: `https://www.kuaishou.com/profile/${eid}` },
      });
    }

    if (profile.scraping_status === 'processing') {
      return {
        status: 'ok',
        message: `${profile.nickname || eid} đang được cào.`,
        is_scraping: true,
        profile_id: Number(profile.id),
      };
    }

    const needsDeltaScrape = !wasCreated && profile.is_initial_scraped;
    await this.prisma.scraperKuaishouProfile.update({
      where: { id: profile.id },
      data: { scraping_status: 'processing', scrape_error: null },
    });

    if (needsDeltaScrape) {
      // Delta: chỉ cào 20 video mới nhất, fully async
      this.scrapeProfileVideos(profile.id, 20).catch((err) => {
        this.logger.error(`[KUAISHOU-PROFILE] ${eid} thất bại: ${err.message}`);
      });
      return {
        status: 'ok',
        message: `Đang cập nhật video mới cho kênh ${profile.nickname || eid}...`,
        already_exists: true,
        profile_id: Number(profile.id),
      };
    }

    // Batch đầu SYNCHRONOUS (~20 video, rất nhanh) — trả data ngay cho user
    const freshProfile = await this.prisma.scraperKuaishouProfile.findUniqueOrThrow({ where: { id: profile.id } });
    let result: { created: number; updated: number; items_returned: number };
    try {
      result = await this.ingestVideosSync(freshProfile, 20);
    } catch (err: any) {
      await this.prisma.scraperKuaishouProfile.update({
        where: { id: profile.id },
        data: { scraping_status: 'failed', scrape_error: (err.message || '').slice(0, 500) },
      });
      // Profile vừa tạo mà lỗi ngay từ đầu → xóa placeholder, tránh rác DB.
      if (wasCreated) {
        await this.prisma.scraperKuaishouProfile.delete({ where: { id: profile.id } }).catch(() => {});
      }
      throw new HttpException({ error: err.message || 'Không cào được profile này' }, HttpStatus.BAD_REQUEST);
    }

    if (result.items_returned === 0) {
      await this.prisma.scraperKuaishouProfile.update({
        where: { id: profile.id },
        data: {
          scraping_status: 'idle',
          scrape_error: 'Không có video nào được trả về (user không tồn tại hoặc không có video)',
        },
      });
      if (wasCreated) {
        await this.prisma.scraperKuaishouProfile.delete({ where: { id: profile.id } }).catch(() => {});
      }
      throw new HttpException({ error: 'Không tìm thấy video cho eid này' }, HttpStatus.NOT_FOUND);
    }

    // Dispatch cào tiếp tới tổng 300 video (fire-and-forget) — sẽ tự set scraping_status='completed'
    this.scrapeProfileVideos(profile.id, 300).catch((err) => {
      this.logger.error(`[KUAISHOU-PROFILE] ${eid} continuation thất bại: ${err.message}`);
    });

    const updated = await this.prisma.scraperKuaishouProfile.findUniqueOrThrow({ where: { id: profile.id } });

    return {
      status: 'ok',
      message: `Đã cào ${result.created} video đầu cho kênh ${updated.nickname || eid}. Đang tiếp tục cào thêm...`,
      profile_id: Number(updated.id),
      newly_scraped: true,
    };
  }

  // ─── Toggle bookmark/tracked ─────────────────────────────────────────────

  async toggleProfile(id: bigint, field: 'is_bookmarked' | 'is_tracked'): Promise<boolean> {
    const profile = await this.prisma.scraperKuaishouProfile.findUnique({ where: { id } });
    if (!profile) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    const newValue = !profile[field];
    await this.prisma.scraperKuaishouProfile.update({ where: { id }, data: { [field]: newValue } });
    return newValue;
  }

  // Tự mở khóa profile bị kẹt ở 'processing' quá lâu (worker crash giữa chừng).
  private async resetStaleLocks(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000);
    const result = await this.prisma.scraperKuaishouProfile.updateMany({
      where: { scraping_status: 'processing', updated_at: { lt: cutoff } },
      data: { scraping_status: 'idle' },
    });
    if (result.count > 0) {
      this.logger.warn(`⚠️ Reset ${result.count} profile Kuaishou bị stuck lock`);
    }
  }

  // ─── Periodic: cào video mới cho profile is_tracked=true (cron) ──────────
  // is_tracked là tiêu chí chọn lọc duy nhất; scraping_status chỉ dùng để loại trừ
  // profile đang cào dở (!= 'processing'), không so khớp cứng 1 giá trị cụ thể.

  async periodicRefresh(): Promise<{ total: number; done: number; failed: number }> {
    await this.resetStaleLocks();

    const profiles = await this.prisma.scraperKuaishouProfile.findMany({
      where: { is_tracked: true, is_initial_scraped: true, scraping_status: { not: 'processing' } },
      orderBy: { last_scraped_at: 'asc' },
    });

    if (profiles.length === 0) {
      this.logger.log('[KUAISHOU-PERIODIC] Không có profile nào cần cào định kỳ.');
      return { total: 0, done: 0, failed: 0 };
    }

    this.logger.log(`═══ [KUAISHOU-PERIODIC] Cào video mới cho ${profiles.length} profile(s) ═══`);
    let done = 0;
    let failed = 0;

    for (const profile of profiles) {
      try {
        await this.scrapeProfileVideos(profile.id, 10);
        done++;
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ ${profile.nickname || profile.eid}: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    this.logger.log(`═══ [KUAISHOU-PERIODIC] Xong: ${done}/${profiles.length} OK, ${failed} lỗi ═══`);
    return { total: profiles.length, done, failed };
  }
}
