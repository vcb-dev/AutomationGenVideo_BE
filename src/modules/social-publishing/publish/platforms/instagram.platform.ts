import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { FACEBOOK_GRAPH_BASE, INSTAGRAM_GRAPH_BASE } from '../../platform-api.const';
import { CAROUSEL_MAX_ITEMS } from '../../platform-limits.const';
import { withRetry, DEFAULT_MAX_ATTEMPTS } from '../retry.util';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Có 2 loại tài khoản Instagram:
 *
 * 1. instagram_business  — kết nối qua Facebook OAuth
 *    Token: Facebook Page token
 *    API:   FACEBOOK_GRAPH_BASE/{ig-user-id}/media
 *
 * 2. instagram_direct    — kết nối qua Instagram Login (personal)
 *    Token: Instagram token
 *    API:   INSTAGRAM_GRAPH_BASE/{ig-user-id}/media
 *
 * Phiên bản API khai báo ở platform-api.const.ts — đừng ghi số vào chú thích,
 * nó sẽ lạc hậu ngay lần nâng cấp đầu tiên.
 */

const FB_BASE = FACEBOOK_GRAPH_BASE;
const IG_BASE = INSTAGRAM_GRAPH_BASE;

function isVideoUrl(url: string): boolean {
  return /\.mp4(\?|$)/i.test(url) || /[?&]filename=[^&]+\.mp4(&|$)/i.test(url);
}

@Injectable()
export class InstagramPublisher {
  private readonly logger = new Logger(InstagramPublisher.name);

  private resolveLocalFilePath(mediaUrl?: string): string | null {
    if (!mediaUrl || !mediaUrl.includes('/api/social/media/')) return null;
    const raw = mediaUrl.split('/api/social/media/').pop()?.split('?')[0];
    if (!raw) return null;
    const filename = path.basename(raw);
    if (!filename) return null;
    const uploadBase = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');
    const filePath = path.join(uploadBase, filename);
    return fs.existsSync(filePath) ? filePath : null;
  }

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
      const localFilePath = this.resolveLocalFilePath(opts.mediaUrl);
      if (localFilePath) {
        // Thử upload nhị phân trực tiếp (resumable) qua rupload — không phụ thuộc URL public
        try {
          const initRes = await axios.post(`${base}/${igUserId}/media`, {
            access_token: token,
            upload_type: 'resumable',
            media_type: 'REELS',
            share_to_feed: 'true',
            ...(opts.caption ? { caption: opts.caption } : {}),
            ...(opts.isCarouselItem ? { is_carousel_item: true } : {}),
          }, { timeout: 60000 });

          const containerId = initRes.data?.id;
          const uploadUri = initRes.data?.uri;
          if (containerId && uploadUri) {
            const stat = fs.statSync(localFilePath);
            const stream = fs.createReadStream(localFilePath);
            await axios.post(uploadUri, stream, {
              headers: {
                Authorization: `OAuth ${token}`,
                offset: '0',
                file_size: String(stat.size),
                'Content-Type': 'application/octet-stream',
              },
              maxBodyLength: Infinity,
              maxContentLength: Infinity,
              timeout: 300000,
            });
            this.logger.log(`[IG] Resumable direct upload thành công cho container: ${containerId}`);
            return containerId;
          }
        } catch (resumableErr: any) {
          const errDetail = resumableErr.response?.data ? JSON.stringify(resumableErr.response.data) : resumableErr.message;
          this.logger.warn(`[IG] Resumable upload thất bại (${errDetail}), fallback sang video_url...`);
        }
      }

      params.media_type    = 'REELS';
      params.video_url     = opts.mediaUrl;
      params.share_to_feed = 'true';
      if (opts.caption)        params.caption          = opts.caption;
      if (opts.isCarouselItem) params.is_carousel_item = true;
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
        const statusDetail: string = res.data.status ?? '';
        this.logger.log(`[IG] Container ${containerId} status: ${statusCode}${statusDetail && statusDetail !== statusCode ? ` | ${statusDetail}` : ''}`);
        if (statusCode === 'FINISHED') return;
        if (statusCode === 'ERROR') {
          this.logger.error(`[IG] Container ${containerId} thất bại: ${JSON.stringify(res.data)}`);
          throw new Error(
            `Instagram container failed: ${statusDetail || 'Meta không trả lý do'}` +
            ` (thường do video sai định dạng, sai tỉ lệ, quá dài, hoặc URL media Meta không tải được)`,
          );
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
