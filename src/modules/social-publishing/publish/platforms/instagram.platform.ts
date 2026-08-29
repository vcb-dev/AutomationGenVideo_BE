import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { FACEBOOK_GRAPH_BASE, INSTAGRAM_GRAPH_BASE } from '../../platform-api.const';
import { CAROUSEL_MAX_ITEMS } from '../media-probe.util';
import { withRetry, DEFAULT_MAX_ATTEMPTS } from '../retry.util';
import { isVideoUrl } from '../media-url.util';

/**
 * Có 2 loại tài khoản Instagram:
 *
 * 1. instagram_business  — kết nối qua Facebook OAuth
 *    Token: Facebook Page token
 *    API:   graph.facebook.com/v21.0/{ig-user-id}/media
 *
 * 2. instagram_direct    — kết nối qua Instagram Login (personal)
 *    Token: Instagram token
 *    API:   graph.instagram.com/v21.0/{ig-user-id}/media
 */

const FB_BASE = FACEBOOK_GRAPH_BASE;
const IG_BASE = INSTAGRAM_GRAPH_BASE;

@Injectable()
export class InstagramPublisher {
  private readonly logger = new Logger(InstagramPublisher.name);

  async publish(token: string, opts: {
    caption: string;
    mediaUrls: string[];
    igUserId: string;
    accountType?: string; // 'instagram_business' | 'instagram_via_facebook' | 'instagram_direct' | undefined
  }): Promise<{ postId: string; url?: string }> {
    const { igUserId, caption, mediaUrls, accountType } = opts;
    // Token của flow qua Facebook là PAGE token → phải gọi graph.facebook.com.
    // OAuth strategy lưu type='instagram_via_facebook', auto-save FB pages lưu
    // type='instagram_business' — cả 2 đều là page token, chỉ 'instagram_direct'
    // (token Instagram Login) mới dùng được graph.instagram.com.
    const base = accountType === 'instagram_business' || accountType === 'instagram_via_facebook'
      ? FB_BASE
      : IG_BASE;

    this.logger.log(`[IG] Publish — accountType=${accountType ?? 'direct'} base=${base} igUserId=${igUserId}`);

    if (mediaUrls.length === 0) throw new Error('Instagram yêu cầu ít nhất 1 media');
    if (mediaUrls.length > CAROUSEL_MAX_ITEMS) {
      throw new Error(
        `Instagram chỉ nhận tối đa ${CAROUSEL_MAX_ITEMS} media trong một carousel — nhận ${mediaUrls.length}.`,
      );
    }

    const isVideo = isVideoUrl(mediaUrls[0]);
    let postId: string;

    // ── Single media ──────────────────────────────────────────────────────────
    if (mediaUrls.length === 1) {
      const containerId = await this.createContainer(base, igUserId, token, {
        mediaUrl: mediaUrls[0], caption, isVideo,
      });
      await this.waitForContainer(base, igUserId, token, containerId);
      const res = await axios.post(`${base}/${igUserId}/media_publish`, {
        creation_id: containerId,
        access_token: token,
      }, { timeout: 60000 });
      postId = res.data.id;
    } else {
      // ── Carousel ────────────────────────────────────────────────────────────
      // Tạo container tuần tự (không bắn đồng thời) + retry để tránh bị rate-limit
      // khi có nhiều ảnh/video cùng lúc — giống fix đã áp dụng cho Facebook.
      const childIds: string[] = [];
      const failReasons: string[] = [];
      for (let i = 0; i < mediaUrls.length; i++) {
        const url = mediaUrls[i];
        try {
          const id = await this.createContainerWithRetry(base, igUserId, token, {
            mediaUrl: url,
            isCarouselItem: true,
            isVideo: isVideoUrl(url),
          });
          childIds.push(id);
        } catch (err: any) {
          failReasons.push(`media[${i}]: ${err.message}`);
          this.logger.warn(`[IG] Tạo container thất bại cho media[${i}] sau khi retry: ${err.message}`);
        }
        if (i < mediaUrls.length - 1) await new Promise(r => setTimeout(r, 400));
      }
      if (failReasons.length > 0) {
        // Không đăng carousel thiếu ảnh một cách âm thầm — ném lỗi để cả bài được retry.
        throw new Error(`Chỉ tạo được ${childIds.length}/${mediaUrls.length} media container trên Instagram — ${failReasons.join('; ')}`);
      }
      await Promise.all(childIds.map(id => this.waitForContainer(base, igUserId, token, id)));

      const parentId = await this.createContainer(base, igUserId, token, {
        caption, children: childIds, isCarousel: true,
      });
      await this.waitForContainer(base, igUserId, token, parentId);
      const res = await axios.post(`${base}/${igUserId}/media_publish`, {
        creation_id: parentId,
        access_token: token,
      }, { timeout: 60000 });
      postId = res.data.id;
    }

    // Lấy permalink bài vừa đăng
    const url = await this.getPermalink(base, postId, token);
    this.logger.log(`[IG] Published postId=${postId} url=${url ?? 'N/A'}`);
    return { postId, ...(url ? { url } : {}) };
  }

  private async getPermalink(base: string, postId: string, token: string): Promise<string | undefined> {
    try {
      const res = await axios.get(`${base}/${postId}`, {
        params: { fields: 'permalink', access_token: token },
        timeout: 10000,
      });
      return res.data.permalink ?? undefined;
    } catch (err: any) {
      this.logger.warn(`[IG] Không lấy được permalink cho ${postId}: ${err.message}`);
      return undefined;
    }
  }

  private async createContainer(
    base: string,
    igUserId: string,
    token: string,
    opts: {
      mediaUrl?: string;
      caption?: string;
      isVideo?: boolean;
      isCarouselItem?: boolean;
      isCarousel?: boolean;
      children?: string[];
    },
  ): Promise<string> {
    const params: any = { access_token: token };

    if (opts.isCarousel) {
      params.media_type = 'CAROUSEL';
      params.caption    = opts.caption;
      params.children   = opts.children!.join(',');
    } else if (opts.isVideo) {
      params.video_url = opts.mediaUrl;
      if (opts.isCarouselItem) {
        // Docs Instagram: "To create carousel item containers, create image or video
        // containers instead (reels are not supported)". Đặt REELS cho phần tử con —
        // kèm share_to_feed vốn vô nghĩa với item con — làm container tạo lỗi.
        params.media_type       = 'VIDEO';
        params.is_carousel_item = true;
      } else {
        params.media_type    = 'REELS';
        params.share_to_feed = 'true';
      }
      if (opts.caption) params.caption = opts.caption;
    } else {
      params.image_url = opts.mediaUrl;
      if (opts.caption)        params.caption          = opts.caption;
      if (opts.isCarouselItem) params.is_carousel_item = true;
    }

    try {
      const res = await axios.post(`${base}/${igUserId}/media`, params, { timeout: 60000 });
      this.logger.log(`[IG] Container created: ${res.data.id}`);
      return res.data.id;
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      this.logger.error(`[IG] createContainer failed (${err.response?.status}): ${detail}`);
      const wrapped = new Error(`Instagram createContainer (HTTP ${err.response?.status}): ${detail}`);
      (wrapped as any).status = err.response?.status;
      throw wrapped;
    }
  }

  private async createContainerWithRetry(
    base: string,
    igUserId: string,
    token: string,
    opts: {
      mediaUrl?: string;
      caption?: string;
      isVideo?: boolean;
      isCarouselItem?: boolean;
      isCarousel?: boolean;
      children?: string[];
    },
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  ): Promise<string> {
    return withRetry(() => this.createContainer(base, igUserId, token, opts), {
      maxAttempts,
      onRetry: (err, attempt, wait) =>
        this.logger.warn(`[IG] Tạo container lỗi (lượt ${attempt}), thử lại sau ${wait}ms: ${err.message}`),
    });
  }

  private async waitForContainer(
    base: string,
    _igUserId: string,
    token: string,
    containerId: string,
    maxMs = 600000,
  ) {
    const start = Date.now();
    // Check NGAY lần đầu (không chờ 2s trước) → ảnh thường FINISHED ngay; rồi backoff 1s→3s
    let delay = 1000;
    while (Date.now() - start < maxMs) {
      try {
        const res = await axios.get(`${base}/${containerId}`, {
          params: { fields: 'status_code,status', access_token: token },
          timeout: 15000,
        });
        const statusCode: string = res.data.status_code ?? res.data.status;
        this.logger.log(`[IG] Container ${containerId} status: ${statusCode}`);
        if (statusCode === 'FINISHED') return;
        if (statusCode === 'ERROR') {
          throw new Error(`Instagram container failed (status=ERROR)`);
        }
      } catch (err: any) {
        const status = err.response?.status;
        if (status && status >= 400 && status < 500) {
          const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
          throw new Error(`Instagram container poll failed (HTTP ${status}): ${detail}`);
        }
        if (err.message?.includes('Instagram container')) throw err;
        this.logger.warn(`[IG] Container poll lỗi tạm thời (retrying): ${err.message}`);
      }
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay + 500, 3000);
    }
    throw new Error('Instagram container timeout sau 10 phút');
  }
}
