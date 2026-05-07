import { Injectable, Logger } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';

const PLATFORM_TO_AI: Record<Platform, string> = {
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok',
  DOUYIN: 'douyin',
  XIAOHONGSHU: 'xiaohongshu',
  YOUTUBE: 'youtube',
};

export type EnrichTarget = { userId: string; platform: Platform; username: string };

function parseNumber(val: unknown): number {
  if (val == null || val === '') return 0;
  if (typeof val === 'number' && !Number.isNaN(val)) return Math.floor(val);
  const s = String(val).replace(/,/g, '').replace(/\s/g, '');
  const n = parseInt(s.replace(/\./g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Chuẩn hóa payload /api/search/user-videos/ (Apify) → patch tracked_channels.
 */
export function extractStatsFromUserVideosResponse(
  data: Record<string, unknown> | null | undefined,
  fallbackUsername: string,
): {
  display_name?: string;
  avatar_url?: string;
  total_followers: number | null;
  total_likes: number;
  total_views: number;
  total_videos: number;
  posts_count?: number;
  engagement_rate: number;
} | null {
  if (!data) return null;

  const profile = data.profile as Record<string, unknown> | undefined;
  if (profile && typeof profile === 'object') {
    const rawFollowers =
      profile.follower_count ??
      profile.followers ??
      profile.followersCount ??
      profile.total_followers ??
      profile.subscribers_count ??
      profile.fans ??
      0;
    const followerCount = parseNumber(rawFollowers);
    const pageLikes = parseNumber(profile.total_likes ?? profile.likes ?? profile.like_count);
    const meta = profile.metadata as Record<string, unknown> | undefined;
    const metaSum = parseNumber(meta?.fetched_likes_sum);
    const finalLikes = pageLikes > 0 ? pageLikes : metaSum;
    const avatarUrl =
      (profile.avatar_url as string) ||
      (profile.profilePicUrlHD as string) ||
      (profile.profilePicUrlHd as string) ||
      (profile.profile_pic_url as string) ||
      (profile.profilePicUrl as string) ||
      '';
    const displayName =
      (profile.display_name as string) ||
      (profile.fullName as string) ||
      (profile.fullname as string) ||
      (profile.name as string) ||
      (profile.username as string) ||
      fallbackUsername;
    const results = data.results as unknown[] | undefined;
    const resultsLen = Array.isArray(results) ? results.length : 0;
    const rawTotalVideos = parseNumber(profile.total_videos ?? profile.media_count);
    const rawPostsCount = parseNumber(profile.posts_count ?? profile.postsCount);
    const finalDisplayName = displayName === fallbackUsername ? undefined : displayName;

    return {
      display_name: finalDisplayName,
      avatar_url: avatarUrl || undefined,
      total_followers: followerCount > 0 ? followerCount : null,
      total_likes: finalLikes,
      total_views: parseNumber(profile.total_views),
      // Dùng total_videos từ profile nếu > 0, nếu = 0 thì fallback sang posts_count hoặc số kết quả fetch
      total_videos: rawTotalVideos > 0 ? rawTotalVideos : (rawPostsCount > 0 ? rawPostsCount : resultsLen),
      posts_count: rawPostsCount > 0 ? rawPostsCount : (resultsLen > 0 ? resultsLen : undefined),
      engagement_rate: parseFloat(String(profile.engagement_rate || 0)) || 0,
    };
  }

  const results = data.results as Record<string, unknown>[] | undefined;
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0];
    const authorName = (first.author_name as string) || fallbackUsername;
    const avatar = (first.author_avatar as string) || (first.thumbnail_url as string) || '';
    let followers = 0;
    for (const r of results) {
      const raw = (r.raw_data as Record<string, unknown>) || r;
      const u = (raw.user as Record<string, unknown>) || (raw.author as Record<string, unknown>) || {};
      const f = u.followers ?? u.followersCount ?? u.followerCount;
      if (f) {
        followers = parseNumber(f);
        break;
      }
    }
    const likes = results.reduce((s, r) => s + parseNumber(r.likes_count), 0);
    const views = results.reduce((s, r) => s + parseNumber(r.views_count), 0);
    const comments = results.reduce((s, r) => s + parseNumber(r.comments_count), 0);
    const engagement_rate = views > 0 ? Math.round(((likes + comments) / views) * 10000) / 100 : 0;
    const finalAuthorName = authorName === fallbackUsername ? undefined : authorName;

    return {
      display_name: finalAuthorName,
      avatar_url: avatar || undefined,
      total_followers: followers > 0 ? followers : null,
      total_likes: likes,
      total_views: views,
      total_videos: results.length,
      posts_count: results.length,
      engagement_rate,
    };
  }

  return null;
}

@Injectable()
export class ChannelStatsEnrichmentService {
  private readonly logger = new Logger(ChannelStatsEnrichmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiIntegrationService,
  ) {}

  /**
   * Gọi AI Service (Apify) để lấy profile + vài bài, cập nhật tracked_channels.
   */
  async enrichTrackedChannel(userId: string, platform: Platform, username: string): Promise<boolean> {
    const aiPlat = PLATFORM_TO_AI[platform];
    if (!aiPlat || !username?.trim()) return false;

    try {
      // Tra cứu link_channel từ bảng Channel (huyk_channels) qua lark_channel_id
      // để AI service dùng URL đúng (VD: profile.php?id=... thay vì /61580182263005)
      let channelUrl: string | undefined;
      const tc = await this.prisma.trackedChannel.findFirst({
        where: { user_id: userId, platform, username: username.trim(), is_active: true },
        select: { lark_channel_id: true },
      });
      if (tc?.lark_channel_id) {
        const ch = await (this.prisma as any).channel.findUnique({
          where: { id: tc.lark_channel_id },
          select: { link_channel: true },
        });
        if (ch?.link_channel?.trim()) {
          channelUrl = ch.link_channel.trim();
          this.logger.log(`[enrich] Sử dụng link_channel: ${channelUrl} cho ${platform}/${username}`);
        }
      }

      const data = (await this.ai.getUserVideos(
        aiPlat,
        username.trim(),
        15,
        undefined,
        undefined,
        undefined,
        true, // forceRefresh = true (Bắt buộc crawl mới qua Apify, không dùng DB cache cũ)
        channelUrl, // URL đầy đủ từ link_channel
      )) as Record<string, unknown>;

      const patch = extractStatsFromUserVideosResponse(data, username);
      if (!patch) {
        this.logger.debug(`[enrich] no profile/results for ${platform}/${username}`);
        return false;
      }
      this.logger.debug(`[enrich] patch for ${username}: ${JSON.stringify(patch)}`);

      const n = await this.prisma.trackedChannel.updateMany({
        where: {
          user_id: userId,
          platform,
          username: username.trim(),
          is_active: true,
        },
        data: {
          display_name: patch.display_name ?? undefined,
          avatar_url: patch.avatar_url ?? undefined,
          total_followers: patch.total_followers,
          total_likes: BigInt(patch.total_likes),
          total_views: BigInt(patch.total_views),
          total_videos: patch.total_videos,
          posts_count: patch.posts_count,
          engagement_rate: patch.engagement_rate,
          last_synced_at: new Date(),
        } as any,
      });

      return n.count > 0;
    } catch (e: any) {
      this.logger.error(`[enrich] ${platform}/${username} Exception: ${e.message}`, e.stack);
      return false;
    }
  }

  /**
   * Làm giàu nhiều kênh, giới hạn song song để tránh quá tải Apify.
   */
  async enrichBatch(
    targets: EnrichTarget[],
    opts?: { concurrency?: number },
  ): Promise<{ ok: number; failed: number }> {
    const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 2, 5));
    let ok = 0;
    let failed = 0;
    const queue = [...targets];
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift();
        if (!t) break;
        const success = await this.enrichTrackedChannel(t.userId, t.platform, t.username);
        if (success) ok++;
        else failed++;
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return { ok, failed };
  }
}
