import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { SocialPlatform } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../social-publishing/crypto/crypto.service';

/**
 * Đồng bộ kênh Instagram NỘI BỘ từ các tài khoản đã kết nối OAuth ở trang đăng bài MXH.
 *
 * Trước module này, `scraper_instagram_profiles.is_owned` không có đường nào để bật: 89 tài
 * khoản Instagram đã kết nối, 44 profile trong kho đã có 2.213 reels, nhưng cờ `is_owned`
 * đều bằng false nên trang Tổng quan kênh nội bộ lọc sạch Instagram — trang chỉ còn Facebook.
 *
 * Threads đã giải đúng bài này (ThreadsOwnedAccountsService): tài khoản kết nối chính là
 * nguồn sự thật về "kênh nào là của công ty", không bắt ai đi tick tay. Module này làm y hệt
 * cho Instagram.
 *
 * ── Token và endpoint ────────────────────────────────────────────────────────
 * Instagram có hai luồng kết nối, token khác nhau — xem InstagramPublisher:
 *   - `instagram_business` (qua Facebook): token là PAGE token → graph.facebook.com
 *   - `instagram_direct` (Instagram Login):  token Instagram   → graph.instagram.com
 * Gọi nhầm host thì Graph API trả 190/100 chứ không phải lỗi rõ ràng, nên phải chọn theo
 * `extra_data.type` đúng như luồng đăng bài đang làm.
 */

const FB_BASE = 'https://graph.facebook.com/v21.0';
const IG_BASE = 'https://graph.instagram.com/v21.0';

/** Số media lấy về mỗi lần đồng bộ cho một kênh. */
const MEDIA_LIMIT = 50;

const HTTP_TIMEOUT_MS = 15_000;

/** Chỉ những loại này mới là video có lượt xem — ảnh và carousel không có. */
const VIDEO_MEDIA_TYPES = ['VIDEO', 'REELS'];

export interface FetchedInstagramProfile {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
}

export interface FetchedInstagramMedia {
  id: string;
  shortcode?: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

export interface InstagramSyncResult {
  accounts: number;
  createdProfiles: number;
  updatedProfiles: number;
  syncedMedia: number;
  failed: number;
}

/** Bóc hashtag khỏi caption, bỏ dấu '#' và hạ chữ thường — khớp cách scraper đang lưu. */
export function extractHashtags(caption: string): string[] {
  const found = caption.match(/#[\p{L}\p{N}_]+/gu) || [];
  return [...new Set(found.map((t) => t.slice(1).toLowerCase()))];
}

/** graph.facebook.com hay graph.instagram.com — xem chú thích đầu file. */
export function resolveApiBase(accountType?: string | null): string {
  return accountType === 'instagram_direct' ? IG_BASE : FB_BASE;
}

/**
 * Instagram User ID để gọi Graph API. `extra_data.igUserId` là nguồn chính; `platform_id` chỉ
 * là phương án dự phòng, giống thứ tự ưu tiên bên publish.service.ts.
 */
export function resolveInstagramUserId(extra: Record<string, unknown> | null, platformId: string): string | null {
  const fromExtra = extra?.igUserId;
  if (typeof fromExtra === 'string' && fromExtra) return fromExtra;
  return platformId || null;
}

@Injectable()
export class InstagramOwnedAccountsService {
  private readonly logger = new Logger(InstagramOwnedAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Đồng bộ toàn bộ tài khoản Instagram đã kết nối OAuth trong SocialAccount.
   *
   * Một kênh có thể được nhiều người cùng kết nối (bảng unique theo (user_id, platform,
   * platform_id)), nên phải gộp theo Instagram User ID trước, nếu không cùng một kênh sẽ bị
   * gọi API và ghi đè nhiều lần trong một lượt chạy.
   */
  async syncAllConnectedAccounts(): Promise<InstagramSyncResult> {
    const socialAccounts = await this.prisma.socialAccount.findMany({
      where: { platform: SocialPlatform.INSTAGRAM, is_active: true },
      orderBy: { created_at: 'asc' },
    });

    const byInstagramUser = new Map<string, (typeof socialAccounts)[number]>();
    for (const account of socialAccounts) {
      const extra = account.extra_data as Record<string, unknown> | null;
      const igUserId = resolveInstagramUserId(extra, account.platform_id);
      if (!igUserId) {
        this.logger.warn(`[IGSync] Bỏ qua ${account.username || account.name}: không có Instagram User ID`);
        continue;
      }
      if (!byInstagramUser.has(igUserId)) byInstagramUser.set(igUserId, account);
    }

    let createdProfiles = 0;
    let updatedProfiles = 0;
    let syncedMedia = 0;
    let failed = 0;

    for (const [igUserId, account] of byInstagramUser) {
      try {
        let token = '';
        try {
          token = this.crypto.decrypt(account.access_token_enc);
        } catch (e: any) {
          this.logger.error(`[IGSync] Giải mã token hỏng cho tài khoản ${account.id}: ${e.message}`);
          failed++;
          continue;
        }

        const extra = account.extra_data as Record<string, unknown> | null;
        const base = resolveApiBase(extra?.type as string | undefined);

        const profileData = await this.fetchUserProfile(base, igUserId, token);
        if (!profileData) {
          failed++;
          continue;
        }

        const profile = await this.upsertProfile(profileData);
        if (profile.created) createdProfiles++;
        else updatedProfiles++;

        syncedMedia += await this.syncProfileMedia(profile.id, base, igUserId, token);

        await this.prisma.scraperInstagramProfile.update({
          where: { id: profile.id },
          data: {
            last_scraped_at: new Date(),
            scraping_status: 'idle',
            scrape_error: null,
            is_initial_scraped: true,
          },
        });
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ [IGSync] Lỗi đồng bộ ${account.username || account.name}: ${err.message}`);
        if (account.username) {
          await this.prisma.scraperInstagramProfile
            .updateMany({
              where: { username: account.username },
              data: {
                last_scraped_at: new Date(),
                scraping_status: 'failed',
                scrape_error: err.message,
              },
            })
            .catch(() => {});
        }
      }
    }

    this.logger.log(
      `✅ [IGSync] Hoàn tất: ${byInstagramUser.size} kênh từ ${socialAccounts.length} tài khoản kết nối ` +
        `(+${createdProfiles} mới, ~${updatedProfiles} cập nhật), ${syncedMedia} bài${failed ? `, ${failed} lỗi` : ''}`,
    );

    return {
      accounts: byInstagramUser.size,
      createdProfiles,
      updatedProfiles,
      syncedMedia,
      failed,
    };
  }

  /** Danh sách kênh Instagram đang được tính là nội bộ. */
  async getOwnedProfiles() {
    return this.prisma.scraperInstagramProfile.findMany({
      where: { is_owned: true },
      orderBy: { followers_count: 'desc' },
      select: {
        id: true,
        username: true,
        full_name: true,
        avatar_url: true,
        followers_count: true,
        posts_count: true,
        is_owned: true,
        is_tracked: true,
        last_scraped_at: true,
        scrape_error: true,
      },
    });
  }

  async fetchUserProfile(
    base: string,
    igUserId: string,
    accessToken: string,
  ): Promise<FetchedInstagramProfile | null> {
    try {
      const res = await axios.get(`${base}/${igUserId}`, {
        params: {
          access_token: accessToken,
          fields: 'id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count',
        },
        timeout: HTTP_TIMEOUT_MS,
      });
      return res.data;
    } catch (err: any) {
      this.logger.error(
        `[IGSync] fetchUserProfile hỏng cho ${igUserId}: ${err.response?.data?.error?.message || err.message}`,
      );
      return null;
    }
  }

  /**
   * Lưu hoặc cập nhật ScraperInstagramProfile và đánh dấu là kênh nội bộ.
   *
   * KHÔNG đụng tới `is_tracked`/`is_bookmarked`: đó là lựa chọn của người dùng ở trang Khám
   * phá kênh, đồng bộ mà ghi đè thì mỗi sáng cron lại xoá tay người ta một lần.
   */
  async upsertProfile(p: FetchedInstagramProfile): Promise<{ id: bigint; created: boolean }> {
    const existing = await this.prisma.scraperInstagramProfile.findFirst({
      where: { OR: [{ instagram_id: p.id }, { username: p.username }] },
    });

    const data = {
      instagram_id: p.id,
      username: p.username,
      full_name: p.name || p.username,
      url: `https://www.instagram.com/${p.username}/`,
      avatar_url: p.profile_picture_url || null,
      biography: p.biography || '',
      is_business: true,
      is_owned: true,
      ...(p.followers_count !== undefined ? { followers_count: BigInt(p.followers_count) } : {}),
      ...(p.follows_count !== undefined ? { following_count: BigInt(p.follows_count) } : {}),
      ...(p.media_count !== undefined ? { posts_count: p.media_count } : {}),
    };

    if (existing) {
      await this.prisma.scraperInstagramProfile.update({ where: { id: existing.id }, data });
      return { id: existing.id, created: false };
    }

    const created = await this.prisma.scraperInstagramProfile.create({ data });
    return { id: created.id, created: true };
  }

  /** Đồng bộ media của một kênh. Chỉ lưu video/reels — bảng reels không chứa ảnh. */
  async syncProfileMedia(
    profileId: bigint,
    base: string,
    igUserId: string,
    accessToken: string,
    limit = MEDIA_LIMIT,
  ): Promise<number> {
    const media = await this.fetchUserMedia(base, igUserId, accessToken, limit);
    let count = 0;

    for (const item of media) {
      if (!isVideoMedia(item)) continue;

      const plays = await this.fetchMediaViews(base, item.id, accessToken);
      const caption = item.caption || '';
      const shortcode = item.shortcode || extractShortcode(item.permalink) || item.id;

      const data = {
        profile_id: profileId,
        post_id: item.id,
        shortcode,
        url: item.permalink || `https://www.instagram.com/reel/${shortcode}/`,
        description: caption,
        hashtags: extractHashtags(caption),
        thumbnail_url: item.thumbnail_url || item.media_url || null,
        play_count: BigInt(plays ?? 0),
        likes_count: BigInt(item.like_count ?? 0),
        comments_count: BigInt(item.comments_count ?? 0),
        date_posted: new Date(item.timestamp),
      };

      await this.prisma.scraperInstagramReel.upsert({
        where: { post_id: item.id },
        create: data,
        // Giữ nguyên profile_id cũ: một reel không đổi chủ, và ghi đè sẽ hỏng nếu username
        // vừa được đổi tên thành một profile khác.
        update: {
          url: data.url,
          description: data.description,
          hashtags: data.hashtags,
          thumbnail_url: data.thumbnail_url,
          play_count: data.play_count,
          likes_count: data.likes_count,
          comments_count: data.comments_count,
          date_posted: data.date_posted,
        },
      });
      count++;
    }

    return count;
  }

  async fetchUserMedia(
    base: string,
    igUserId: string,
    accessToken: string,
    limit: number,
  ): Promise<FetchedInstagramMedia[]> {
    try {
      const res = await axios.get(`${base}/${igUserId}/media`, {
        params: {
          access_token: accessToken,
          limit,
          fields:
            'id,shortcode,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
        },
        timeout: HTTP_TIMEOUT_MS,
      });
      return res.data?.data ?? [];
    } catch (err: any) {
      this.logger.error(
        `[IGSync] fetchUserMedia hỏng cho ${igUserId}: ${err.response?.data?.error?.message || err.message}`,
      );
      return [];
    }
  }

  /**
   * Lượt xem của một media. Meta đổi tên chỉ số này nhiều lần (`plays` → `views`), nên thử
   * lần lượt và chấp nhận 0 nếu không có — thà thiếu lượt xem còn hơn hỏng cả lượt đồng bộ.
   */
  async fetchMediaViews(base: string, mediaId: string, accessToken: string): Promise<number> {
    try {
      const res = await axios.get(`${base}/${mediaId}/insights`, {
        params: { access_token: accessToken, metric: 'views,plays' },
        timeout: HTTP_TIMEOUT_MS,
      });
      const rows: { name?: string; values?: { value?: number }[] }[] = res.data?.data ?? [];
      for (const name of ['views', 'plays']) {
        const row = rows.find((r) => r.name === name);
        const value = row?.values?.[0]?.value;
        if (typeof value === 'number') return value;
      }
      return 0;
    } catch {
      // Insight không lấy được là chuyện thường: media quá cũ, hoặc tài khoản không đủ quyền.
      return 0;
    }
  }
}

/** Reels và video thường; ảnh/carousel không vào bảng reels. */
export function isVideoMedia(item: FetchedInstagramMedia): boolean {
  return (
    VIDEO_MEDIA_TYPES.includes((item.media_product_type || '').toUpperCase()) ||
    VIDEO_MEDIA_TYPES.includes((item.media_type || '').toUpperCase())
  );
}

/** https://www.instagram.com/reel/ABC123/ → ABC123 */
export function extractShortcode(permalink?: string): string | null {
  if (!permalink) return null;
  const m = permalink.match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/);
  return m ? m[1] : null;
}
