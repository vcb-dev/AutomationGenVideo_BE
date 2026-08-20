import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../social-publishing/crypto/crypto.service';
import { SocialPlatform } from '@prisma/client';

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

export interface FetchedThreadsProfile {
  id: string;
  username: string;
  name?: string;
  threads_profile_picture_url?: string;
  threads_biography?: string;
}

export interface FetchedThreadsMedia {
  id: string;
  media_type?: string;
  permalink?: string;
  text?: string;
  timestamp: string;
  shortcode?: string;
  thumbnail_url?: string;
  media_url?: string;
  views?: number;
  likes?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
}

@Injectable()
export class ThreadsOwnedAccountsService {
  private readonly logger = new Logger(ThreadsOwnedAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Đồng bộ toàn bộ tài khoản Threads đã kết nối OAuth trong SocialAccount.
   */
  async syncAllConnectedAccounts(): Promise<{
    accounts: number;
    createdProfiles: number;
    updatedProfiles: number;
    syncedPosts: number;
    failed: number;
  }> {
    const socialAccounts = await this.prisma.socialAccount.findMany({
      where: { platform: SocialPlatform.THREADS, is_active: true },
      orderBy: { created_at: 'asc' },
    });

    let createdProfiles = 0;
    let updatedProfiles = 0;
    let syncedPosts = 0;
    let failed = 0;

    for (const sa of socialAccounts) {
      try {
        let token = '';
        try {
          token = this.crypto.decrypt(sa.access_token_enc);
        } catch (e: any) {
          this.logger.error(`[ThreadsSync] Decrypt token failed for account ${sa.id}: ${e.message}`);
          failed++;
          continue;
        }

        const profileData = await this.fetchUserProfile(token);
        if (!profileData) {
          failed++;
          continue;
        }

        const profile = await this.upsertProfile(profileData);
        if (profile.created) {
          createdProfiles++;
        } else {
          updatedProfiles++;
        }

        const postCount = await this.syncProfilePosts(profile.id, token);
        syncedPosts += postCount;

        await this.prisma.scraperThreadsProfile.update({
          where: { id: profile.id },
          data: {
            last_scraped_at: new Date(),
            scraping_status: 'idle',
            scrape_error: null,
          },
        });
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ [ThreadsSync] Lỗi đồng bộ tài khoản ${sa.username || sa.name}: ${err.message}`);
        if (sa.username) {
          await this.prisma.scraperThreadsProfile.updateMany({
            where: { username: sa.username },
            data: {
              last_scraped_at: new Date(),
              scraping_status: 'failed',
              scrape_error: err.message,
            },
          }).catch(() => {});
        }
      }
    }

    this.logger.log(
      `✅ [ThreadsSync] Hoàn tất: ${socialAccounts.length} tài khoản (+${createdProfiles} mới, ~${updatedProfiles} cập nhật), ` +
        `${syncedPosts} bài viết${failed ? `, ${failed} lỗi` : ''}`,
    );

    return {
      accounts: socialAccounts.length,
      createdProfiles,
      updatedProfiles,
      syncedPosts,
      failed,
    };
  }

  /**
   * Lấy thông tin user profile từ Threads Graph API.
   */
  async fetchUserProfile(accessToken: string): Promise<FetchedThreadsProfile | null> {
    try {
      const res = await axios.get(`${THREADS_API_BASE}/me`, {
        params: {
          access_token: accessToken,
          fields: 'id,username,name,threads_profile_picture_url,threads_biography',
        },
        timeout: 15000,
      });
      return res.data;
    } catch (err: any) {
      this.logger.error(`[ThreadsSync] fetchUserProfile failed: ${err.response?.data?.error?.message || err.message}`);
      return null;
    }
  }

  /**
   * Lưu hoặc cập nhật ScraperThreadsProfile.
   */
  async upsertProfile(p: FetchedThreadsProfile): Promise<{ id: bigint; created: boolean }> {
    const existing = await this.prisma.scraperThreadsProfile.findFirst({
      where: {
        OR: [
          { username: p.username },
          { threads_user_id: p.id },
        ],
      },
    });

    const data = {
      threads_user_id: p.id,
      username: p.username,
      name: p.name || p.username,
      url: `https://www.threads.net/@${p.username}`,
      avatar_url: p.threads_profile_picture_url || null,
      biography: p.threads_biography || '',
      is_owned: true,
    };

    if (existing) {
      await this.prisma.scraperThreadsProfile.update({
        where: { id: existing.id },
        data,
      });
      return { id: existing.id, created: false };
    }

    const created = await this.prisma.scraperThreadsProfile.create({
      data,
    });
    return { id: created.id, created: true };
  }

  /**
   * Đồng bộ bài viết và insight views cho 1 profile.
   */
  async syncProfilePosts(profileId: bigint, accessToken: string, limit = 50): Promise<number> {
    const posts = await this.fetchUserThreads(accessToken, limit);
    let count = 0;

    for (const item of posts) {
      const insights = await this.fetchMediaInsights(item.id, accessToken);
      const viewsCount = insights?.views ?? item.views ?? 0;
      const likesCount = insights?.likes ?? item.likes ?? 0;
      const repliesCount = insights?.replies ?? item.replies ?? 0;
      const repostsCount = insights?.reposts ?? item.reposts ?? 0;
      const quotesCount = insights?.quotes ?? item.quotes ?? 0;

      const hashtags = this.extractHashtags(item.text || '');
      const thumbnail = item.thumbnail_url || (item.media_type === 'IMAGE' ? item.media_url : null);
      const url = item.permalink || `https://www.threads.net/t/${item.shortcode || item.id}`;

      const existing = await this.prisma.scraperThreadsPost.findUnique({
        where: { post_id: item.id },
        select: { id: true, views_count: true },
      });

      const postData = {
        profile_id: profileId,
        shortcode: item.shortcode || null,
        url,
        text: item.text || '',
        hashtags,
        thumbnail_url: thumbnail,
        media_type: item.media_type || 'TEXT',
        views_count: BigInt(viewsCount),
        likes_count: BigInt(likesCount),
        replies_count: BigInt(repliesCount),
        reposts_count: BigInt(repostsCount),
        quotes_count: BigInt(quotesCount),
        date_posted: new Date(item.timestamp),
      };

      if (existing) {
        // Giữ số views cũ nếu lần này trả 0 hoặc lỗi insight
        if (viewsCount === 0 && Number(existing.views_count) > 0) {
          postData.views_count = existing.views_count;
        }
        await this.prisma.scraperThreadsPost.update({
          where: { id: existing.id },
          data: postData,
        });
      } else {
        await this.prisma.scraperThreadsPost.create({
          data: {
            post_id: item.id,
            ...postData,
          },
        });
      }
      count++;
    }

    return count;
  }

  /**
   * Lấy danh sách bài viết trên Threads của user.
   */
  async fetchUserThreads(accessToken: string, limit = 50): Promise<FetchedThreadsMedia[]> {
    try {
      const res = await axios.get(`${THREADS_API_BASE}/me/threads`, {
        params: {
          access_token: accessToken,
          fields: 'id,media_type,permalink,text,timestamp,shortcode,thumbnail_url,media_url',
          limit,
        },
        timeout: 20000,
      });
      return res.data?.data || [];
    } catch (err: any) {
      this.logger.warn(`[ThreadsSync] fetchUserThreads failed: ${err.response?.data?.error?.message || err.message}`);
      return [];
    }
  }

  /**
   * Lấy insight metrics (views, likes, replies, reposts, quotes) của 1 bài Threads.
   */
  async fetchMediaInsights(mediaId: string, accessToken: string): Promise<{
    views?: number;
    likes?: number;
    replies?: number;
    reposts?: number;
    quotes?: number;
  } | null> {
    try {
      const res = await axios.get(`${THREADS_API_BASE}/${mediaId}/insights`, {
        params: {
          access_token: accessToken,
          metric: 'views,likes,replies,reposts,quotes',
        },
        timeout: 10000,
      });

      const metricsList = res.data?.data || [];
      const result: Record<string, number> = {};
      for (const m of metricsList) {
        if (m.name && m.values?.[0]?.value !== undefined) {
          result[m.name] = Number(m.values[0].value);
        }
      }

      return {
        views: result.views,
        likes: result.likes,
        replies: result.replies,
        reposts: result.reposts,
        quotes: result.quotes,
      };
    } catch (err: any) {
      // Một số bài không có insight (hoặc token thiếu quyền) - trả null để fallback
      return null;
    }
  }

  private extractHashtags(text: string): string[] {
    if (!text) return [];
    const matches = text.match(/#([a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]+)/g);
    if (!matches) return [];
    return matches.map((t) => t.replace(/^#/, '').toLowerCase());
  }

  /**
   * Danh sách profiles Threads nội bộ.
   */
  async getOwnedProfiles() {
    const profiles = await this.prisma.scraperThreadsProfile.findMany({
      where: { is_owned: true },
      orderBy: { followers_count: 'desc' },
      include: {
        _count: {
          select: { posts: true },
        },
      },
    });

    return profiles.map((p) => ({
      id: p.id.toString(),
      threads_user_id: p.threads_user_id,
      username: p.username,
      name: p.name,
      url: p.url,
      avatar_url: p.avatar_url,
      biography: p.biography,
      followers_count: Number(p.followers_count),
      is_verified: p.is_verified,
      is_owned: p.is_owned,
      last_scraped_at: p.last_scraped_at,
      scraping_status: p.scraping_status,
      scrape_error: p.scrape_error,
      posts_count: p._count.posts,
    }));
  }

  /**
   * Toggle theo dõi hoặc sở hữu profile Threads.
   */
  async toggleOwned(username: string, isOwned: boolean) {
    return this.prisma.scraperThreadsProfile.update({
      where: { username },
      data: { is_owned: isOwned },
    });
  }
}
