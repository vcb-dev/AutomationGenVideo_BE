import { Injectable, Logger } from "@nestjs/common";
import { resolveShortLink } from "../../../common/utils/resolve-short-link.util";
import { extractYoutubeVideoId } from "./youtube-url.util";

export interface YoutubeVideoStatsResult {
  status: "success" | "failed" | "unsupported";
  views?: number;
  likes?: number;
  comments?: number;
  error?: string;
}

// Kéo view/like/comment cho video YouTube CÔNG KHAI qua YouTube Data API v3
// (videos.list?part=statistics, YOUTUBE_API_KEY — không phải OAuth). Không có khái niệm "owned
// page" như Facebook. API không có "shares" công khai → PublishedLinkStats.shares luôn 0.
@Injectable()
export class YoutubeVideoStatsService {
  private readonly logger = new Logger(YoutubeVideoStatsService.name);
  private loggedMissingKey = false;

  private apiKey(): string | undefined {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key && !this.loggedMissingKey) {
      this.loggedMissingKey = true;
      this.logger.warn("Thiếu YOUTUBE_API_KEY trong .env — link YouTube sẽ luôn trả 'unsupported'.");
    }
    return key;
  }

  async fetchStatsForUrl(rawUrl: string): Promise<YoutubeVideoStatsResult> {
    const apiKey = this.apiKey();
    if (!apiKey) return { status: "unsupported" };

    const resolvedUrl = await resolveShortLink(rawUrl);
    const videoId = extractYoutubeVideoId(resolvedUrl);
    if (!videoId) return { status: "unsupported" };

    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.searchParams.set("part", "statistics");
      url.searchParams.set("id", videoId);
      url.searchParams.set("key", apiKey);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      let res: Response;
      try {
        res = await fetch(url.toString(), { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { status: "failed", error: `YouTube API HTTP ${res.status}: ${body}`.slice(0, 300) };
      }

      const data: any = await res.json();
      const stats = data?.items?.[0]?.statistics;
      if (!stats) {
        return { status: "failed", error: "Không tìm thấy video (có thể đã bị xoá hoặc để riêng tư)" };
      }

      return {
        status: "success",
        views: Number(stats.viewCount ?? 0),
        likes: Number(stats.likeCount ?? 0),
        comments: Number(stats.commentCount ?? 0),
      };
    } catch (err: any) {
      return { status: "failed", error: (err.message || "Lỗi không xác định").slice(0, 300) };
    }
  }
}
