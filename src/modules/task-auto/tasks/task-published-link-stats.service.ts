import { Injectable } from "@nestjs/common";
import { FacebookOwnedPagesService } from "../../facebook-owned-pages/facebook-owned-pages.service";
import { InstagramOwnedAccountsService } from "../../instagram-owned-accounts/instagram-owned-accounts.service";
import { YoutubeVideoStatsService } from "./youtube-video-stats.service";

export interface PublishedLinkStats {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  status: "success" | "failed" | "unsupported";
  fetched_at: string;
  error?: string;
}

// Nguồn duy nhất liệt kê platform đã hỗ trợ tự kéo số liệu — nơi khác (vd kpi.service.ts)
// import hằng số này thay vì tự liệt kê lại, để không bị lệch khi thêm/bớt platform.
export const SUPPORTED_LINK_STATS_PLATFORMS = ["FACEBOOK", "YOUTUBE", "INSTAGRAM"] as const;

export function isSupportedLinkStatsPlatform(platform: string): boolean {
  return (SUPPORTED_LINK_STATS_PLATFORMS as readonly string[]).includes(
    (platform || "").trim().toUpperCase(),
  );
}

// Ngưỡng "còn mới" cho stats đã cào — refreshContentWinFailStats() (kpi.service.ts) BỎ QUA link
// đã cào trong khoảng này thay vì cào lại mỗi lần bấm "Cập nhật", tránh dội request FB/YouTube.
export const LINK_STATS_FRESH_MS = 15 * 60 * 1000;

export function isLinkStatsFresh(
  stats: { fetched_at?: string } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!stats?.fetched_at) return false;
  const fetchedAt = new Date(stats.fetched_at).getTime();
  if (Number.isNaN(fetchedAt)) return false;
  return now.getTime() - fetchedAt < LINK_STATS_FRESH_MS;
}

// Dispatcher theo platform cho tính năng tự kéo tương tác của link bài đăng — thêm platform mới chỉ cần sửa ở đây.
@Injectable()
export class TaskPublishedLinkStatsService {
  constructor(
    private readonly facebookOwnedPages: FacebookOwnedPagesService,
    private readonly youtubeVideoStats: YoutubeVideoStatsService,
    private readonly instagramOwnedAccounts: InstagramOwnedAccountsService,
  ) {}

  async fetchStatsForLink(
    platform: string,
    url: string,
  ): Promise<PublishedLinkStats> {
    const fetched_at = new Date().toISOString();
    const normalizedPlatform = (platform || "").trim().toUpperCase();

    if (!isSupportedLinkStatsPlatform(normalizedPlatform)) {
      return {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        status: "unsupported",
        fetched_at,
      };
    }

    try {
      if (normalizedPlatform === "YOUTUBE") {
        const result = await this.youtubeVideoStats.fetchStatsForUrl(url);
        if (result.status !== "success") {
          return { views: 0, likes: 0, comments: 0, shares: 0, status: result.status, fetched_at, error: result.error };
        }
        // YouTube Data API không có field "shares" công khai — luôn 0 cho platform này.
        return {
          views: result.views ?? 0,
          likes: result.likes ?? 0,
          comments: result.comments ?? 0,
          shares: 0,
          status: "success",
          fetched_at,
        };
      }

      if (normalizedPlatform === "INSTAGRAM") {
        const result = await this.instagramOwnedAccounts.fetchStatsForUrl(url);
        if (result.status !== "success") {
          return { views: 0, likes: 0, comments: 0, shares: 0, status: result.status, fetched_at, error: result.error };
        }
        // Instagram Graph API không có field "shares" công khai cho media — luôn 0, giống YouTube.
        return {
          views: result.views ?? 0,
          likes: result.likes ?? 0,
          comments: result.comments ?? 0,
          shares: 0,
          status: "success",
          fetched_at,
        };
      }

      const result = await this.facebookOwnedPages.fetchStatsForUrl(url);
      if (result.status !== "success") {
        return {
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          status: result.status,
          fetched_at,
          error: result.error,
        };
      }
      return {
        views: result.views ?? 0,
        likes: result.likes ?? 0,
        comments: result.comments ?? 0,
        shares: result.shares ?? 0,
        status: "success",
        fetched_at,
      };
    } catch (err: any) {
      return {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        status: "failed",
        fetched_at,
        error: (err.message || "Lỗi không xác định").slice(0, 300),
      };
    }
  }
}
