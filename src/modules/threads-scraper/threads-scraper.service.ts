import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ScraperThreadsProfile } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DEFAULT_TARGET_COUNT } from '../../common/utils/target-count.util';
import { extractThreadsUsername } from '../../common/utils/channel-url.util';
import { DeleteChannelResult, buildDeleteChannelResult } from '../../common/utils/delete-channel.util';
import {
  ThreadsAiClientService,
  ParsedThreadsFullProfile,
  ParsedThreadsPost,
} from './threads-ai-client.service';

export const TOGGLE_FIELDS = ['is_bookmarked', 'is_tracked', 'is_owned'] as const;
export type ThreadsToggleField = (typeof TOGGLE_FIELDS)[number];
export const MANAGED_TOGGLE_FIELDS: readonly ThreadsToggleField[] = ['is_tracked', 'is_owned'];

@Injectable()
export class ThreadsScraperService {
  private readonly logger = new Logger(ThreadsScraperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: ThreadsAiClientService,
  ) {}

  async createOrGetProfile(
    username: string,
    initialData?: { is_tracked?: boolean; is_bookmarked?: boolean },
  ): Promise<ScraperThreadsProfile> {
    const cleanUsername = extractThreadsUsername(username) || username.trim().toLowerCase().replace(/^@/, '');
    if (!cleanUsername) {
      throw new HttpException('Username Threads không được để trống', HttpStatus.BAD_REQUEST);
    }

    const existing = await this.prisma.scraperThreadsProfile.findUnique({
      where: { username: cleanUsername },
    });
    if (existing) {
      return existing;
    }

    // ĐẶC BIỆT QUAN TRỌNG: Kênh khám phá bên ngoài PHẢI lưu is_owned = false
    // để không lẫn vào Kênh nội bộ công ty. Mặc định is_tracked = true cho kênh thêm trực tiếp,
    // nhưng là false khi tự động lưu tác giả từ bài viết tìm kiếm.
    return this.prisma.scraperThreadsProfile.create({
      data: {
        username: cleanUsername,
        name: cleanUsername,
        url: `https://www.threads.net/@${cleanUsername}`,
        is_owned: false,
        is_tracked: initialData?.is_tracked !== undefined ? initialData.is_tracked : true,
        is_bookmarked: initialData?.is_bookmarked ?? false,
        scraping_status: 'idle',
      },
    });
  }

  async applyFullProfileUpdate(profileId: bigint, fp: ParsedThreadsFullProfile): Promise<void> {
    await this.prisma.scraperThreadsProfile.update({
      where: { id: profileId },
      data: {
        threads_user_id: fp.threads_user_id || undefined,
        name: fp.name || undefined,
        url: fp.url || undefined,
        avatar_url: fp.avatar_url || undefined,
        biography: fp.biography || undefined,
        followers_count: BigInt(fp.followers_count || 0),
        is_verified: fp.is_verified,
      },
    });
  }

  async upsertPost(profileId: bigint, p: ParsedThreadsPost): Promise<{ created: boolean }> {
    const existing = await this.prisma.scraperThreadsPost.findUnique({
      where: { post_id: p.post_id },
    });

    const data = {
      profile_id: profileId,
      shortcode: p.shortcode || null,
      url: p.url || '',
      text: p.text || '',
      thumbnail_url: p.thumbnail_url || null,
      media_type: p.media_type || 'TEXT',
      views_count: BigInt(p.views_count || 0),
      likes_count: BigInt(p.likes_count || 0),
      replies_count: BigInt(p.replies_count || 0),
      reposts_count: BigInt(p.reposts_count || 0),
      quotes_count: BigInt(p.quotes_count || 0),
      date_posted: new Date(p.date_posted),
    };

    if (existing) {
      await this.prisma.scraperThreadsPost.update({
        where: { post_id: p.post_id },
        data,
      });
      return { created: false };
    }

    await this.prisma.scraperThreadsPost.create({
      data: { ...data, post_id: p.post_id },
    });
    return { created: true };
  }

  async scrapeProfilePosts(
    profileId: bigint,
    numOfPosts: number = DEFAULT_TARGET_COUNT,
    options?: { mode?: 'count' | 'days'; days?: number },
  ): Promise<{ created: number; updated: number; items_returned: number }> {
    const profile = await this.prisma.scraperThreadsProfile.findUnique({
      where: { id: profileId },
    });
    if (!profile) {
      throw new HttpException(`Profile Threads id ${profileId} không tồn tại`, HttpStatus.NOT_FOUND);
    }

    await this.prisma.scraperThreadsProfile.update({
      where: { id: profileId },
      data: { scraping_status: 'processing', scrape_error: null },
    });

    try {
      const fetchTarget = options?.mode === 'days' && options?.days && options.days > 0
        ? Math.max(numOfPosts, Math.min(150, options.days * 5))
        : numOfPosts;

      const { full_profile, posts } = await this.aiClient.fetchProfilePosts(
        profile.username,
        fetchTarget,
      );

      if (full_profile) {
        await this.applyFullProfileUpdate(profileId, full_profile);
      }

      const cutoffDate = options?.mode === 'days' && options?.days && options.days > 0
        ? new Date(Date.now() - options.days * 86400000)
        : null;

      let created = 0;
      let updated = 0;
      for (const p of posts || []) {
        if (cutoffDate && p.date_posted && new Date(p.date_posted) < cutoffDate) {
          continue;
        }
        const res = await this.upsertPost(profileId, p);
        if (res.created) created++;
        else updated++;
      }

      await this.prisma.scraperThreadsProfile.update({
        where: { id: profileId },
        data: {
          scraping_status: 'completed',
          scrape_error: null,
          last_scraped_at: new Date(),
        },
      });

      return { created, updated, items_returned: (posts || []).length };
    } catch (err: any) {
      this.logger.error(`[ThreadsScraper] Scrape @${profile.username} thất bại: ${err.message}`);
      await this.prisma.scraperThreadsProfile.update({
        where: { id: profileId },
        data: {
          scraping_status: 'failed',
          scrape_error: err.message || 'Lỗi khi cào dữ liệu từ TikHub',
        },
      });
      throw err;
    }
  }

  async scrapeByUsername(
    username: string,
    targetCount: number = DEFAULT_TARGET_COUNT,
    options?: { mode?: 'count' | 'days'; days?: number; is_tracked?: boolean },
  ): Promise<{ profile: any; created: number; updated: number; items_returned: number }> {
    const profile = await this.createOrGetProfile(username, {
      is_tracked: options?.is_tracked ?? true,
    });
    const result = await this.scrapeProfilePosts(profile.id, targetCount, options);
    const refreshed = await this.prisma.scraperThreadsProfile.findUnique({
      where: { id: profile.id },
    });
    return { profile: refreshed, ...result };
  }

  async toggle(profileId: bigint, field: ThreadsToggleField, value: boolean): Promise<any> {
    if (!TOGGLE_FIELDS.includes(field)) {
      throw new HttpException(`Trường ${field} không hợp lệ`, HttpStatus.BAD_REQUEST);
    }

    return this.prisma.scraperThreadsProfile.update({
      where: { id: profileId },
      data: { [field]: value },
    });
  }

  async searchHotPosts(
    query: string,
    count: number = DEFAULT_TARGET_COUNT,
    options?: { mode?: 'count' | 'days'; days?: number },
  ): Promise<{ query: string; posts: ParsedThreadsPost[] }> {
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) {
      throw new HttpException('Từ khoá tìm kiếm không được để trống', HttpStatus.BAD_REQUEST);
    }

    // 1. Chỉ coi query là kênh/tác giả Threads nếu người dùng cố ý nhập:
    // - Bắt đầu bằng '@' (ví dụ: @lilbieber)
    // - HOẶC đường dẫn URL của Threads (ví dụ: threads.net/@lilbieber, https://www.threads.net/...)
    // Tuyệt đối không coi từ khoá tìm kiếm thường (kể cả 1 từ như 'topic', 'vang', 'nhan') là kênh tác giả!
    const isExplicitHandleOrUrl =
      cleanQuery.startsWith('@') ||
      cleanQuery.toLowerCase().includes('threads.net');

    const cutoffDate = options?.mode === 'days' && options?.days && options.days > 0
      ? new Date(Date.now() - options.days * 86400000)
      : null;

    if (isExplicitHandleOrUrl) {
      const usernameMatch = cleanQuery
        .replace(/^https?:\/\/(www\.)?threads\.net\/@?/i, '')
        .replace(/^@/, '')
        .split(/[/?]/)[0]
        .trim();

      if (usernameMatch && /^[a-zA-Z0-9._]+$/.test(usernameMatch)) {
        try {
          const scrapeRes = await this.scrapeByUsername(usernameMatch, count, {
            ...options,
            is_tracked: false,
          });
          if (scrapeRes && scrapeRes.profile) {
            const whereClause: any = { profile_id: scrapeRes.profile.id };
            if (cutoffDate) {
              whereClause.date_posted = { gte: cutoffDate };
            }
            const profilePosts = await this.prisma.scraperThreadsPost.findMany({
              where: whereClause,
              orderBy: { likes_count: 'desc' },
              take: count,
              include: { profile: true },
            });
            if (profilePosts.length > 0) {
              return {
                query: cleanQuery,
                posts: profilePosts.map((p) => ({
                  post_id: p.post_id,
                  shortcode: p.shortcode || '',
                  url: p.url,
                  text: p.text || '',
                  media_type: p.media_type,
                  thumbnail_url: p.thumbnail_url || '',
                  video_url: '',
                  views_count: Number(p.views_count),
                  likes_count: Number(p.likes_count),
                  replies_count: Number(p.replies_count),
                  reposts_count: Number(p.reposts_count),
                  quotes_count: Number(p.quotes_count),
                  date_posted: p.date_posted.toISOString(),
                  author_username: p.profile.username,
                  author_name: p.profile.name || p.profile.username,
                  author_avatar: p.profile.avatar_url || '',
                  is_vietnamese: /[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/i.test(p.text || ''),
                })),
              };
            }
          }
        } catch (err: any) {
          this.logger.warn(`Search as username @${usernameMatch} failed: ${err.message}`);
        }
      }
    }

    // 2. Tìm kiếm nội dung trực tiếp qua AI service (hỗ trợ cào live bài viết Threads theo từ khoá/chủ đề)
    try {
      const fetchCount = options?.mode === 'days' && options?.days && options.days > 0
        ? Math.max(count, Math.min(100, options.days * 8))
        : count;
      const aiRes = await this.aiClient.searchTop(cleanQuery, fetchCount);
      if (aiRes && Array.isArray(aiRes.posts) && aiRes.posts.length > 0) {
        const effectivePosts = cutoffDate
          ? aiRes.posts.filter((p) => {
              if (!p.date_posted) return false;
              const pDate = new Date(p.date_posted);
              return !isNaN(pDate.getTime()) && pDate >= cutoffDate;
            })
          : aiRes.posts;

        // TỰ ĐỘNG LƯU TOÀN BỘ BÀI VÀ PROFILE VÀO DATABASE ĐỂ TÁI SỬ DỤNG LÂU DÀI, TRÁNH TỐN CHI PHÍ CÀO LẠI
        try {
          await this.ingestHotPosts(effectivePosts);
          this.logger.log(`Tự động lưu ${effectivePosts.length} bài viết Threads vào kho dữ liệu cho từ khoá "${cleanQuery}"`);
        } catch (ingestErr: any) {
          this.logger.warn(`Lỗi khi tự động lưu bài viết vào database: ${ingestErr.message}`);
        }

        return {
          query: cleanQuery,
          posts: effectivePosts.map((p) => ({
            ...p,
            is_vietnamese: p.is_vietnamese ?? /[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/i.test(p.text || ''),
          })),
        };
      }
    } catch (aiErr: any) {
      this.logger.warn(`AI searchTop failed for "${cleanQuery}": ${aiErr.message}`);
    }

    // 3. Fallback: Tìm kiếm trong database cục bộ nếu AI/mạng gặp sự cố
    const dbPosts = await this.prisma.scraperThreadsPost.findMany({
      where: {
        OR: [
          { text: { contains: cleanQuery, mode: 'insensitive' } },
          { profile: { username: { contains: cleanQuery, mode: 'insensitive' } } },
          { profile: { name: { contains: cleanQuery, mode: 'insensitive' } } },
        ],
      },
      orderBy: { likes_count: 'desc' },
      take: count,
      include: { profile: true },
    });

    return {
      query: cleanQuery,
      posts: dbPosts.map((p) => ({
        post_id: p.post_id,
        shortcode: p.shortcode || '',
        url: p.url,
        text: p.text || '',
        media_type: p.media_type,
        thumbnail_url: p.thumbnail_url || '',
        video_url: '',
        views_count: Number(p.views_count),
        likes_count: Number(p.likes_count),
        replies_count: Number(p.replies_count),
        reposts_count: Number(p.reposts_count),
        quotes_count: Number(p.quotes_count),
        date_posted: p.date_posted.toISOString(),
        author_username: p.profile.username,
        author_name: p.profile.name || p.profile.username,
        author_avatar: p.profile.avatar_url || '',
        is_vietnamese: /[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/i.test(p.text || ''),
      })),
    };
  }

  async ingestHotPosts(posts: ParsedThreadsPost[]): Promise<{ saved_count: number }> {
    if (!Array.isArray(posts) || posts.length === 0) {
      return { saved_count: 0 };
    }

    let saved = 0;
    for (const p of posts) {
      if (!p.post_id) continue;
      const username = (p.author_username || 'anonymous').trim().replace(/^@/, '');
      // KHÔNG tự ý đánh dấu tác giả bài viết là 'Kênh chú ý' (is_tracked = false)
      const profile = await this.createOrGetProfile(username, { is_tracked: false });
      await this.upsertPost(profile.id, p);
      saved++;
    }
    return { saved_count: saved };
  }

  async deleteProfile(profileId: bigint): Promise<DeleteChannelResult> {
    const profile = await this.prisma.scraperThreadsProfile.findUnique({
      where: { id: profileId },
      select: { id: true, name: true, username: true },
    });
    if (!profile) {
      throw new HttpException(`Profile ${profileId} không tồn tại`, HttpStatus.NOT_FOUND);
    }

    const videosDeleted = await this.prisma.scraperThreadsPost.count({
      where: { profile_id: profileId },
    });

    await this.prisma.scraperThreadsProfile.delete({
      where: { id: profileId },
    });

    return buildDeleteChannelResult(profileId, profile.name || profile.username, videosDeleted);
  }

  async periodicRefresh(options?: {
    scope?: 'tracked' | 'bookmarked' | 'all';
    mode?: 'count' | 'days';
    count?: number;
    days?: number;
  }): Promise<{ total: number; done: number; failed: number }> {
    const scope = options?.scope || 'tracked';
    const where: any = { scraping_status: { not: 'processing' }, is_owned: false };
    if (scope === 'tracked') {
      where.is_tracked = true;
    } else if (scope === 'bookmarked') {
      where.is_bookmarked = true;
    }

    const profiles = await this.prisma.scraperThreadsProfile.findMany({
      where,
      orderBy: { last_scraped_at: 'asc' },
    });

    if (profiles.length === 0) {
      this.logger.log(`[THREADS-PERIODIC] Không có profile (${scope}) nào cần cào.`);
      return { total: 0, done: 0, failed: 0 };
    }

    this.logger.log(`═══ [THREADS-PERIODIC] Cào bài viết mới cho ${profiles.length} profile(s) (scope: ${scope}, mode: ${options?.mode || 'default'}) ═══`);
    let done = 0;
    let failed = 0;

    for (const profile of profiles) {
      try {
        const count = options?.count && options.count > 0 ? options.count : 30;
        await this.scrapeProfilePosts(profile.id, count, {
          mode: options?.mode,
          days: options?.days,
        });
        done++;
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ @${profile.username}: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    this.logger.log(`═══ [THREADS-PERIODIC] Xong: ${done}/${profiles.length} OK, ${failed} lỗi ═══`);
    return { total: profiles.length, done, failed };
  }

  async batchScrape(
    usernames: string[],
    targetCount: number = DEFAULT_TARGET_COUNT,
    options?: { mode?: 'count' | 'days'; days?: number },
  ): Promise<{ results: any[]; total: number; succeeded: number; failed: number }> {
    const results = [];
    let succeeded = 0;
    let failed = 0;
    for (const u of usernames) {
      const clean = u.trim().replace(/^@/, '');
      if (!clean) continue;
      try {
        const res = await this.scrapeByUsername(clean, targetCount, options);
        results.push({ username: clean, success: true, profile: res.profile, items: res.items_returned });
        succeeded++;
      } catch (err: any) {
        results.push({ username: clean, success: false, error: err.message });
        failed++;
      }
    }
    return { results, total: results.length, succeeded, failed };
  }
}

