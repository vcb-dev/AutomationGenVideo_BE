import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ThreadsPublisher {
  private readonly logger = new Logger(ThreadsPublisher.name);
  private readonly BASE = 'https://graph.threads.net/v1.0';

  async publish(token: string, opts: {
    text: string; mediaUrls?: string[]; userId: string;
  }): Promise<{ postId: string }> {
    const { userId, text, mediaUrls } = opts;

    if (!mediaUrls?.length) {
      const cid = await this.createContainer(userId, token, { text, mediaType: 'TEXT' });
      return this.publishContainer(userId, token, cid);
    }

    if (mediaUrls.length === 1) {
      const isVideo = /\.mp4(\?|$)/i.test(mediaUrls[0]);
      const cid = await this.createContainer(userId, token, {
        text, mediaType: isVideo ? 'VIDEO' : 'IMAGE',
        mediaUrl: mediaUrls[0],
      });
      await this.waitForContainer(cid, token);
      return this.publishContainer(userId, token, cid);
    }

    // Carousel
    const childIds = await Promise.all(mediaUrls.map((url) => {
      const isVid = /\.mp4(\?|$)/i.test(url);
      return this.createContainer(userId, token, {
        mediaType: isVid ? 'VIDEO' : 'IMAGE', mediaUrl: url, isCarouselItem: true,
      });
    }));
    for (const id of childIds) await this.waitForContainer(id, token);
    const cid = await this.createContainer(userId, token, { text, mediaType: 'CAROUSEL', children: childIds });
    await this.waitForContainer(cid, token);
    return this.publishContainer(userId, token, cid);
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
    const res = await axios.post(`${this.BASE}/${userId}/threads`, params);
    return res.data.id;
  }

  private async waitForContainer(containerId: string, token: string, maxMs = 180000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 3000));
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
    }
    throw new Error('Threads container timeout sau 3 phút');
  }

  private async publishContainer(userId: string, token: string, containerId: string): Promise<{ postId: string }> {
    const res = await axios.post(`${this.BASE}/${userId}/threads_publish`, {
      creation_id: containerId, access_token: token,
    });
    return { postId: res.data.id };
  }
}
