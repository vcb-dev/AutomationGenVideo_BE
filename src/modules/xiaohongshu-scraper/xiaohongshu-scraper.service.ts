import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { XiaohongshuAiClientService, ParsedXhsVideo, ParsedXhsAuthor } from './xiaohongshu-ai-client.service';

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

  async searchKeyword(keyword: string, count = 20): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    let cursor: unknown = undefined;
    let hasMore = true;

    for (let round = 0; round < XiaohongshuScraperService.MAX_SEARCH_ROUNDS && created < count && hasMore; round++) {
      const remaining = count - created;
      const { videos, cursor: nextCursor, has_more } = await this.aiClient.fetchSearch(keyword, remaining, cursor);
      if (videos.length === 0) break;

      for (const v of videos) {
        const r = await this.upsertVideo(v, { keyword });
        if (r.created) created++;
        else updated++;
      }

      cursor = nextCursor;
      hasMore = has_more;
    }

    this.logger.log(`[XHS] Ingest '${keyword}': +${created} new, ~${updated} updated`);
    return { created, updated };
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

  async scrapeProfile(userId: string, isOwned?: boolean): Promise<any> {
    let profile = await this.prisma.scraperXiaohongshuProfile.findUnique({ where: { user_id: userId } });
    const wasCreated = !profile;
    if (!profile) {
      profile = await this.prisma.scraperXiaohongshuProfile.create({
        data: { user_id: userId, scraping_status: 'idle', is_owned: !!isOwned },
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
      // Delta: chỉ cào 50 video mới nhất, fully async như cũ
      this.scrapeProfileVideos(profile.id, 50).catch((err) => {
        this.logger.error(`[XHS-PROFILE] ${userId} thất bại: ${err.message}`);
      });
      return {
        status: 'ok',
        message: `Đang cập nhật video mới cho user ${userId}...`,
        profile: await this.toProfileDict(profile),
        created: wasCreated,
      };
    }

    // Batch đầu SYNCHRONOUS (~20 video, rất nhanh) — trả data ngay cho user
    const freshProfile = await this.prisma.scraperXiaohongshuProfile.findUniqueOrThrow({ where: { id: profile.id } });
    const result = await this.ingestProfileVideosSync(freshProfile, 20);

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

    // Dispatch cào tiếp tới tổng 300 video (fire-and-forget) — sẽ tự set scraping_status='idle'
    this.scrapeProfileVideos(profile.id, 300).catch((err) => {
      this.logger.error(`[XHS-PROFILE] ${userId} continuation thất bại: ${err.message}`);
    });

    const updatedProfile = await this.prisma.scraperXiaohongshuProfile.findUniqueOrThrow({ where: { id: profile.id } });

    return {
      status: 'ok',
      message: `Đã cào ${result.created} video đầu cho user ${userId}. Đang tiếp tục cào thêm...`,
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

  async periodicRefresh(): Promise<{ total: number; done: number; failed: number }> {
    await this.resetStaleLocks();

    const profiles = await this.prisma.scraperXiaohongshuProfile.findMany({
      where: { is_tracked: true, is_initial_scraped: true, scraping_status: { not: 'processing' } },
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
