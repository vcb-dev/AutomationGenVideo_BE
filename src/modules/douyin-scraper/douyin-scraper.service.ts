import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DouyinAiClientService, ParsedDouyinVideo } from './douyin-ai-client.service';

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
  ) {}

  // ─── Upsert 1 video (giữ nguyên business rule preserve Drive URL / keyword cũ) ──

  private async upsertVideo(v: ParsedDouyinVideo, keywordOverride?: string): Promise<{ created: boolean }> {
    const existing = await this.prisma.scraperDouyinVideo.findUnique({ where: { post_id: v.post_id } });

    const preview_image = existing && isDriveUrl(existing.preview_image) ? existing.preview_image : v.thumbnail_url;
    const resolvedKeyword = v.search_keyword || keywordOverride || '';
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

  async searchKeyword(keyword: string, count = 30): Promise<{ created: number; updated: number }> {
    const { videos } = await this.aiClient.fetchSearch(keyword, count);
    let created = 0;
    let updated = 0;
    for (const v of videos) {
      const r = await this.upsertVideo(v);
      if (r.created) created++;
      else updated++;
    }
    this.logger.log(`[DOUYIN] Ingest '${keyword}': +${created} new, ~${updated} updated`);
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

  async scrapeProfile(secUserId: string, isOwned?: boolean): Promise<any> {
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

      this.scrapeProfileVideos(profile.id, 30).catch((err) => {
        this.logger.error(`[DOUYIN-PROFILE] ${secUserId} thất bại: ${err.message}`);
      });

      return {
        status: 'ok',
        message: 'Đang cập nhật profile Douyin...',
        profile_id: Number(profile.id),
        already_exists: true,
      };
    }

    // Profile mới → cào đồng bộ 20 video đầu (await) để trả dữ liệu ngay
    const result = await this.scrapeProfileVideos(profile.id, 20);
    if (result.videos_returned === 0) {
      await this.prisma.scraperDouyinProfile.delete({ where: { id: profile.id } }).catch(() => {});
      throw new HttpException({ error: 'Không tìm thấy video cho sec_user_id này' }, HttpStatus.NOT_FOUND);
    }

    // Dispatch cào tiếp tới tổng 300 video (fire-and-forget)
    this.scrapeProfileVideos(profile.id, 300).catch((err) => {
      this.logger.error(`[DOUYIN-PROFILE] ${secUserId} continuation thất bại: ${err.message}`);
    });

    const updatedProfile = await this.prisma.scraperDouyinProfile.findUniqueOrThrow({ where: { id: profile.id } });
    const label = updatedProfile.username || secUserId.slice(0, 20);

    return {
      status: 'ok',
      message: `Đã cào ${result.created} posts đầu cho @${label}. Đang tiếp tục cào thêm...`,
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
