import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

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

const FB_BASE = 'https://graph.facebook.com/v21.0';
const IG_BASE = 'https://graph.instagram.com/v21.0';

@Injectable()
export class InstagramPublisher {
  private readonly logger = new Logger(InstagramPublisher.name);

  async publish(token: string, opts: {
    caption: string;
    mediaUrls: string[];
    igUserId: string;
    accountType?: string; // 'instagram_business' | 'instagram_direct' | undefined
  }): Promise<{ postId: string }> {
    const { igUserId, caption, mediaUrls, accountType } = opts;
    const base = accountType === 'instagram_business' ? FB_BASE : IG_BASE;

    this.logger.log(`[IG] Publish — accountType=${accountType ?? 'direct'} base=${base} igUserId=${igUserId}`);

    if (mediaUrls.length === 0) throw new Error('Instagram yêu cầu ít nhất 1 media');

    const isVideo = /\.mp4(\?|$)/i.test(mediaUrls[0]);

    // ── Single media ──────────────────────────────────────────────────────────
    if (mediaUrls.length === 1) {
      const containerId = await this.createContainer(base, igUserId, token, {
        mediaUrl: mediaUrls[0], caption, isVideo,
      });
      await this.waitForContainer(base, igUserId, token, containerId);
      const res = await axios.post(`${base}/${igUserId}/media_publish`, {
        creation_id: containerId,
        access_token: token,
      });
      return { postId: res.data.id };
    }

    // ── Carousel ──────────────────────────────────────────────────────────────
    const childIds = await Promise.all(
      mediaUrls.map(url =>
        this.createContainer(base, igUserId, token, {
          mediaUrl: url,
          isCarouselItem: true,
          isVideo: /\.mp4(\?|$)/i.test(url),
        }),
      ),
    );
    for (const id of childIds) await this.waitForContainer(base, igUserId, token, id);

    const parentId = await this.createContainer(base, igUserId, token, {
      caption, children: childIds, isCarousel: true,
    });
    await this.waitForContainer(base, igUserId, token, parentId);
    const res = await axios.post(`${base}/${igUserId}/media_publish`, {
      creation_id: parentId,
      access_token: token,
    });
    return { postId: res.data.id };
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
      const res = await axios.post(`${base}/${igUserId}/media`, params);
      this.logger.log(`[IG] Container created: ${res.data.id}`);
      return res.data.id;
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      this.logger.error(`[IG] createContainer failed (${err.response?.status}): ${detail}`);
      throw new Error(`Instagram createContainer (HTTP ${err.response?.status}): ${detail}`);
    }
  }

  private async waitForContainer(
    base: string,
    igUserId: string,
    token: string,
    containerId: string,
    maxMs = 180000,
  ) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 3000));
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
    }
    throw new Error('Instagram container timeout sau 3 phút');
  }
}
