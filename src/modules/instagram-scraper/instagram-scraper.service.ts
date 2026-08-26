import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DEFAULT_TARGET_COUNT } from '../../common/utils/target-count.util';
import { DeleteChannelResult, buildDeleteChannelResult } from '../../common/utils/delete-channel.util';
import {
  InstagramAiClientService,
  ParsedInstagramFullProfile,
  ParsedInstagramFallbackUser,
  ParsedInstagramReel,
} from './instagram-ai-client.service';

const STALE_LOCK_MINUTES = 30;

/**
 * Các cờ bật/tắt được trên một profile Instagram.
 *
 * `is_owned` = kênh của công ty, không phải kênh đối thủ đang theo dõi. Đây là tiêu chí duy
 * nhất để trang Tổng quan kênh nội bộ tính một profile vào số liệu — xem
 * owned-stats.service.ts (`WHERE p.is_owned = true`).
 */
export const TOGGLE_FIELDS = ['is_bookmarked', 'is_tracked', 'is_owned'] as const;
export type InstagramToggleField = (typeof TOGGLE_FIELDS)[number];

/** Cờ đụng tới số liệu chung của công ty — chỉ leader/admin. `is_bookmarked` là ghim cá nhân. */
export const MANAGED_TOGGLE_FIELDS: readonly InstagramToggleField[] = ['is_tracked', 'is_owned'];

// Toàn bộ logic ghi DB port từ AI (tikhub_instagram.py::upsert_profile_from_user_info/
// upsert_profile_from_item/ingest_instagram_reels đã xóa + scraper_views.py::
// instagram_profile_scrape/instagram_profile_toggle + tasks.py::
// scrape_instagram_profile_reels_task/periodic_scrape_instagram_profiles_task).
// AI giờ chỉ fetch + parse (instagram_fetch_views.py), BE là nơi duy nhất ghi
// scraper_instagram_profiles / scraper_instagram_reels / scraper_instagram_profile_metrics.
@Injectable()
export class InstagramScraperService {
  private readonly logger = new Logger(InstagramScraperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: InstagramAiClientService,
  ) {}

  // Khớp upsert_profile_from_user_info cũ — ghi đè toàn bộ field không điều kiện.
  private async applyFullProfileUpdate(profileId: bigint, fp: ParsedInstagramFullProfile): Promise<void> {
    await this.prisma.scraperInstagramProfile.update({
      where: { id: profileId },
      data: {
        url: fp.url,
        instagram_id: fp.instagram_id,
        full_name: fp.full_name,
        avatar_url: fp.avatar_url,
        hd_avatar_url: fp.hd_avatar_url,
        biography: fp.biography,
        bio_links: fp.bio_links,
        external_url: fp.external_url,
        is_verified: fp.is_verified,
        is_private: fp.is_private,
        is_business: fp.is_business,
        category: fp.category,
        followers_count: BigInt(fp.followers_count || 0),
        following_count: BigInt(fp.following_count || 0),
        posts_count: fp.posts_count,
      },
    });
  }

  // Khớp upsert_profile_from_item cũ — url/is_verified ghi đè không điều kiện,
  // avatar_url chỉ ghi đè nếu có giá trị. Chạy LUÔN sau full_profile (khớp code gốc:
  // ingest_instagram_reels luôn gọi upsert_profile_from_item bất kể user_info có hay không).
  private async applyFallbackUpdate(profileId: bigint, fb: ParsedInstagramFallbackUser): Promise<void> {
    const data: any = { url: fb.url, is_verified: fb.is_verified };
    if (fb.avatar_url) data.avatar_url = fb.avatar_url;
    await this.prisma.scraperInstagramProfile.update({ where: { id: profileId }, data });
  }

  private async upsertReel(profileId: bigint, r: ParsedInstagramReel): Promise<{ created: boolean }> {
    const existing = await this.prisma.scraperInstagramReel.findUnique({ where: { post_id: r.post_id } });
    const data = {
      profile_id: profileId,
      shortcode: r.shortcode,
      url: r.url,
      description: r.description,
      hashtags: r.hashtags,
      thumbnail_url: r.thumbnail_url,
      duration_seconds: r.duration_seconds,
      is_paid_partnership: r.is_paid_partnership,
      play_count: BigInt(r.play_count || 0),
      likes_count: BigInt(r.likes_count || 0),
      comments_count: BigInt(r.comments_count || 0),
      date_posted: new Date(r.date_posted),
    };

    if (existing) {
      await this.prisma.scraperInstagramReel.update({ where: { post_id: r.post_id }, data });
      return { created: false };
    }
    await this.prisma.scraperInstagramReel.create({ data: { ...data, post_id: r.post_id } });
    return { created: true };
  }

  // Task đầy đủ — quản lý scraping_status lifecycle (processing → completed/idle/failed).
  async scrapeProfileReels(
    profileId: bigint,
    numOfPosts: number,
  ): Promise<{ created: number; updated: number; items_returned: number }> {
    const profile = await this.prisma.scraperInstagramProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new Error(`Profile ${profileId} không tồn tại`);

    if (profile.scraping_status !== 'processing') {
      await this.prisma.scraperInstagramProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'processing', scrape_error: null },
      });
    }

    try {
      const { full_profile, fallback_user, reels } = await this.aiClient.fetchProfileReels(
        profile.username,
        numOfPosts,
      );

      if (reels.length === 0) {
        await this.prisma.scraperInstagramProfile.update({
          where: { id: profileId },
          data: {
            scraping_status: 'idle',
            scrape_error: 'TikHub không trả về reels (profile không có video hoặc là private)',
          },
        });
        return { created: 0, updated: 0, items_returned: 0 };
      }

      // Bước 1: full profile info nếu fetch_user_info thành công
      if (full_profile) await this.applyFullProfileUpdate(profileId, full_profile);
      // Bước 2: fallback update từ reel mới nhất (luôn chạy, khớp code gốc)
      if (fallback_user) await this.applyFallbackUpdate(profileId, fallback_user);

      if (!profile.is_initial_scraped) {
        await this.prisma.scraperInstagramProfile.update({
          where: { id: profileId },
          data: { is_initial_scraped: true },
        });
      }

      // Metrics snapshot — dùng giá trị followers/following/posts hiện tại SAU khi đã update
      const freshProfile = await this.prisma.scraperInstagramProfile.findUniqueOrThrow({ where: { id: profileId } });
      await this.prisma.scraperInstagramProfileMetrics.create({
        data: {
          profile_id: profileId,
          followers_count: freshProfile.followers_count,
          following_count: freshProfile.following_count,
          posts_count: freshProfile.posts_count,
        },
      });

      let created = 0;
      let updated = 0;
      for (const r of reels) {
        const result = await this.upsertReel(profileId, r);
        if (result.created) created++;
        else updated++;
      }

      await this.prisma.scraperInstagramProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'completed', scrape_error: null, last_scraped_at: new Date() },
      });

      this.logger.log(`[IG-PROFILE] @${profile.username}: +${created} mới, ~${updated} cập nhật`);
      return { created, updated, items_returned: reels.length };
    } catch (err: any) {
      await this.prisma.scraperInstagramProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'failed', scrape_error: (err.message || '').slice(0, 500) },
      });
      throw err;
    }
  }

  // Batch đầu SYNCHRONOUS (~20 reels) — chỉ fetch + upsert, KHÔNG đổi scraping_status
  // (giữ nguyên 'processing' để phần nền tiếp tục), khớp pattern TikTok/Douyin.
  private async ingestProfileReelsSync(
    profile: { id: bigint; username: string },
    count: number,
  ): Promise<{ created: number; updated: number; items_returned: number }> {
    const { full_profile, fallback_user, reels } = await this.aiClient.fetchProfileReels(profile.username, count);
    if (reels.length === 0) return { created: 0, updated: 0, items_returned: 0 };

    if (full_profile) await this.applyFullProfileUpdate(profile.id, full_profile);
    if (fallback_user) await this.applyFallbackUpdate(profile.id, fallback_user);

    let created = 0;
    let updated = 0;
    for (const r of reels) {
      const result = await this.upsertReel(profile.id, r);
      if (result.created) created++;
      else updated++;
    }
    return { created, updated, items_returned: reels.length };
  }

  async scrapeProfile(username: string, isOwned?: boolean, targetCount = DEFAULT_TARGET_COUNT): Promise<any> {
    let profile = await this.prisma.scraperInstagramProfile.findUnique({ where: { username } });
    const wasCreated = !profile;
    if (!profile) {
      profile = await this.prisma.scraperInstagramProfile.create({
        data: { username, url: `https://www.instagram.com/${username}/`, is_owned: !!isOwned },
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
    await this.prisma.scraperInstagramProfile.update({ where: { id: profile.id }, data: updateData });

    // Profile đã cào lần đầu rồi → chỉ cào delta tới targetCount reels mới nhất, fully async
    if (needsDeltaScrape) {
      this.scrapeProfileReels(profile.id, targetCount).catch((err) => {
        this.logger.error(`[IG-PROFILE] ${username} thất bại: ${err.message}`);
      });
      return {
        status: 'ok',
        message: `Đang cập nhật tới ${targetCount} reels mới nhất cho @${username}...`,
        already_exists: true,
        profile_id: Number(profile.id),
      };
    }

    // Batch đầu SYNCHRONOUS (nhỏ, rất nhanh) — trả data ngay cho user, phần còn lại chạy nền
    const firstBatch = Math.min(20, targetCount);
    const freshProfile = await this.prisma.scraperInstagramProfile.findUniqueOrThrow({ where: { id: profile.id } });
    const result = await this.ingestProfileReelsSync(freshProfile, firstBatch);

    if (result.items_returned === 0) {
      if (wasCreated) {
        await this.prisma.scraperInstagramProfile.delete({ where: { id: profile.id } }).catch(() => {});
      } else {
        await this.prisma.scraperInstagramProfile.update({
          where: { id: profile.id },
          data: { scraping_status: 'idle', scrape_error: 'TikHub không trả về reels (profile không có video hoặc là private)' },
        });
      }
      throw new HttpException({ error: 'Không tìm thấy reels cho username này' }, HttpStatus.NOT_FOUND);
    }

    // Dispatch cào tiếp tới tổng targetCount reels (fire-and-forget) — tự set scraping_status='completed'
    const continuationNeeded = targetCount > firstBatch;
    if (continuationNeeded) {
      this.scrapeProfileReels(profile.id, targetCount).catch((err) => {
        this.logger.error(`[IG-PROFILE] ${username} continuation thất bại: ${err.message}`);
      });
    } else {
      // Không có phần chạy nền → tự chốt trạng thái, tránh kẹt 'processing'.
      await this.prisma.scraperInstagramProfile.update({
        where: { id: profile.id },
        data: {
          scraping_status: 'completed',
          scrape_error: null,
          is_initial_scraped: true,
          last_scraped_at: new Date(),
        },
      });
    }

    const batchInfo = `${result.items_returned} reels (${result.created} mới)`;
    return {
      status: 'ok',
      message: continuationNeeded
        ? `Đã cào ${batchInfo} cho @${username}. Đang cào tiếp tới ${targetCount}...`
        : `Đã cào ${batchInfo} cho @${username}.`,
      already_exists: false,
      profile_id: Number(profile.id),
    };
  }

  // ─── Toggle bookmark/tracked ─────────────────────────────────────────────

  async toggleProfile(id: bigint, field: InstagramToggleField): Promise<boolean> {
    const profile = await this.prisma.scraperInstagramProfile.findUnique({ where: { id } });
    if (!profile) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    const newValue = !profile[field];
    await this.prisma.scraperInstagramProfile.update({ where: { id }, data: { [field]: newValue } });
    return newValue;
  }

  // ─── Xoá cứng kênh ──────────────────────────────────────────────────────────

  // Video/metrics gắn khoá ngoại onDelete Cascade nên Postgres tự dọn bảng con.
  // Phải ĐẾM TRƯỚC khi xoá: đếm sau thì cascade đã quét sạch và con số báo về luôn là 0,
  // trong khi FE dùng đúng con số này để nói người dùng vừa mất bao nhiêu video.
  async deleteProfile(id: bigint): Promise<DeleteChannelResult> {
    const profile = await this.prisma.scraperInstagramProfile.findUnique({ where: { id } });
    if (!profile) throw new HttpException({ error: 'Không tìm thấy kênh' }, HttpStatus.NOT_FOUND);

    const videosDeleted = await this.prisma.scraperInstagramReel.count({ where: { profile_id: id } });
    await this.prisma.scraperInstagramProfile.delete({ where: { id } });

    const name = profile.full_name || profile.username;
    this.logger.warn(`[INSTAGRAM] Đã xoá cứng kênh "${name}" (id=${id}) kèm ${videosDeleted} video.`);
    return buildDeleteChannelResult(id, name, videosDeleted);
  }

  // Tự mở khóa profile bị kẹt ở 'processing' quá lâu (worker crash giữa chừng), tránh
  // bị loại khỏi cron định kỳ vĩnh viễn — khớp pattern _reset_stale_locks() của Facebook.
  private async resetStaleLocks(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000);
    const result = await this.prisma.scraperInstagramProfile.updateMany({
      where: { scraping_status: 'processing', updated_at: { lt: cutoff } },
      data: { scraping_status: 'idle' },
    });
    if (result.count > 0) {
      this.logger.warn(`⚠️ Reset ${result.count} profile Instagram bị stuck lock`);
    }
  }

  // ─── Periodic: cào reels mới cho profile is_tracked=true (cron) ─────────
  // is_tracked là tiêu chí chọn lọc duy nhất; scraping_status chỉ dùng để loại trừ
  // profile đang cào dở (!= 'processing'), không so khớp cứng 1 giá trị cụ thể.
  // (Đã sửa so với code gốc: code gốc lọc scraping_status='idle' nhưng task lại set
  // 'completed' khi xong, khiến profile chỉ được cron chọn đúng 1 lần rồi thôi.)

  async periodicRefresh(): Promise<{ total: number; done: number; failed: number }> {
    await this.resetStaleLocks();

    const profiles = await this.prisma.scraperInstagramProfile.findMany({
      where: { is_tracked: true, is_initial_scraped: true, scraping_status: { not: 'processing' } },
      orderBy: { last_scraped_at: 'asc' },
    });

    if (profiles.length === 0) {
      this.logger.log('[IG-PERIODIC] Không có profile nào cần cào định kỳ.');
      return { total: 0, done: 0, failed: 0 };
    }

    this.logger.log(`═══ [IG-PERIODIC] Cào reels mới cho ${profiles.length} profile(s) ═══`);
    let done = 0;
    let failed = 0;

    for (const profile of profiles) {
      try {
        await this.scrapeProfileReels(profile.id, 10);
        done++;
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ @${profile.username}: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    this.logger.log(`═══ [IG-PERIODIC] Xong: ${done}/${profiles.length} OK, ${failed} lỗi ═══`);
    return { total: profiles.length, done, failed };
  }
}
