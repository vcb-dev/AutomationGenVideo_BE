import { Injectable } from "@nestjs/common";
import { FacebookOwnedPagesService } from "../../facebook-owned-pages/facebook-owned-pages.service";

export interface PublishedLinkStats {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  status: "success" | "failed" | "unsupported";
  fetched_at: string;
  error?: string;
}

// Dispatcher theo platform cho tính năng tự kéo tương tác (views/likes/comments/shares)
// của link bài đăng nộp trong Task (PublishedLinksSection). Hiện chỉ Facebook (page nội
// bộ, qua Graph API miễn phí) được hỗ trợ; platform khác trả 'unsupported' — chưa chặn
// nộp link, chỉ đơn giản là chưa có số liệu. Thêm platform mới (TikTok, Douyin...) sau
// này chỉ cần thêm 1 case ở đây, không phải sửa gì ở updatePublishedLinks/cron.
@Injectable()
export class TaskPublishedLinkStatsService {
  constructor(private readonly facebookOwnedPages: FacebookOwnedPagesService) {}

  async fetchStatsForLink(
    platform: string,
    url: string,
  ): Promise<PublishedLinkStats> {
    const fetched_at = new Date().toISOString();
    const normalizedPlatform = (platform || "").trim().toUpperCase();

    if (normalizedPlatform !== "FACEBOOK") {
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
