import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

function isVideoUrl(url: string): boolean {
  return /\.mp4(\?|$)/i.test(url) || /[?&]filename=[^&]+\.mp4(&|$)/i.test(url);
}

@Injectable()
export class ThreadsPublisher {
  private readonly logger = new Logger(ThreadsPublisher.name);
  private readonly BASE = 'https://graph.threads.net/v1.0';

  async publish(token: string, opts: {
    text: string; mediaUrls?: string[]; userId: string;
  }): Promise<{ postId: string; url?: string }> {
    const { userId, text, mediaUrls } = opts;
    let result: { postId: string };

    if (!mediaUrls?.length) {
      const cid = await this.createContainer(userId, token, { text, mediaType: 'TEXT' });
      result = await this.publishContainer(userId, token, cid);
    } else if (mediaUrls.length === 1) {
      const isVideo = isVideoUrl(mediaUrls[0]);
      const cid = await this.createContainer(userId, token, {
        text, mediaType: isVideo ? 'VIDEO' : 'IMAGE',
        mediaUrl: mediaUrls[0],
      });
      await this.waitForContainer(cid, token);
      result = await this.publishContainer(userId, token, cid);
    } else {
      // Carousel
      const childIds = await Promise.all(mediaUrls.map((url) => {
        const isVid = isVideoUrl(url);
        return this.createContainer(userId, token, {
          mediaType: isVid ? 'VIDEO' : 'IMAGE', mediaUrl: url, isCarouselItem: true,
        });
      }));
      await Promise.all(childIds.map(id => this.waitForContainer(id, token)));
      const cid = await this.createContainer(userId, token, { text, mediaType: 'CAROUSEL', children: childIds });
      await this.waitForContainer(cid, token);
      result = await this.publishContainer(userId, token, cid);
    }

    // Lấy permalink bài vừa đăng
    const url = await this.getPermalink(result.postId, token);
    this.logger.log(`[Threads] Published postId=${result.postId} url=${url ?? 'N/A'}`);
    return { ...result, ...(url ? { url } : {}) };
  }

  private async getPermalink(postId: string, token: string): Promise<string | undefined> {
    try {
      const res = await axios.get(`${this.BASE}/${postId}`, {
        params: { fields: 'permalink', access_token: token },
        timeout: 10000,
      });
      return res.data.permalink ?? undefined;
    } catch (err: any) {
      this.logger.warn(`[Threads] Không lấy được permalink cho ${postId}: ${err.message}`);
      return undefined;
    }
  }

  private async createContainer(userId: string, token: string, opts: {
    text?: string; mediaType: string; mediaUrl?: string; isCarouselItem?: boolean; children?: string[];
  }): Promise<string> {
    const params: any = { media_type: opts.mediaType, access_token: token };
    if (opts.text) params.text = opts.text;
    if (opts.mediaUrl) {
      if (opts.mediaType === 'VIDEO') params.video_url = opts.mediaUrl;
      else params.image_url = opts.mediaUrl;
    }
    if (opts.isCarouselItem) params.is_carousel_item = true;
    if (opts.children) params.children = opts.children.join(',');
    try {
      const res = await axios.post(`${this.BASE}/${userId}/threads`, params, { timeout: 30000 });
      this.logger.log(`[Threads] Container created: ${res.data.id}`);
      return res.data.id;
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      this.logger.error(`[Threads] createContainer failed (${err.response?.status}): ${detail}`);
      throw new Error(`Threads createContainer (HTTP ${err.response?.status || 'unknown'}): ${detail}`);
    }
  }

  private async waitForContainer(containerId: string, token: string, maxMs = 180000) {
    const start = Date.now();
    // Check NGAY lần đầu (không chờ 2s trước) → ảnh thường FINISHED ngay; rồi backoff 1s→3s
    let delay = 1000;
    while (Date.now() - start < maxMs) {
      try {
        const res = await axios.get(`${this.BASE}/${containerId}`, {
          params: { fields: 'status,error_message', access_token: token },
          timeout: 15000,
        });
        const { status, error_message } = res.data;
        this.logger.log(`[Threads] Container ${containerId} status: ${status}${error_message ? ` | error: ${error_message}` : ''}`);
        if (status === 'FINISHED') return;
        if (status === 'ERROR') {
          throw new Error(`Threads container error: ${error_message || 'UNKNOWN — video có thể sai định dạng hoặc quá lớn'}`);
        }
      } catch (err: any) {
        // 4xx = lỗi vĩnh viễn — không retry
        const status = err.response?.status;
        if (status && status >= 400 && status < 500) {
          const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
          throw new Error(`Threads container poll failed (HTTP ${status}): ${detail}`);
        }
        if (err.message?.includes('Threads container error')) throw err;
        this.logger.warn(`[Threads] Poll error (retrying): ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay + 500, 3000);
    }
    throw new Error('Threads container timeout sau 3 phút');
  }

  private async publishContainer(userId: string, token: string, containerId: string): Promise<{ postId: string }> {
    try {
      const res = await axios.post(`${this.BASE}/${userId}/threads_publish`, {
        creation_id: containerId, access_token: token,
      }, { timeout: 30000 });
      return { postId: res.data.id };
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      this.logger.error(`[Threads] publishContainer failed (${err.response?.status}): ${detail}`);
      throw new Error(`Threads publishContainer (HTTP ${err.response?.status || 'unknown'}): ${detail}`);
    }
  }
}
