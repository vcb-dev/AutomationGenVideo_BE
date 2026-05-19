import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as FormData from 'form-data';

@Injectable()
export class ZaloPublisher {
  private readonly logger = new Logger(ZaloPublisher.name);

  async publish(token: string, opts: {
    title: string; description?: string; mediaUrls?: string[];
  }): Promise<{ articleId: string }> {
    const headers = { access_token: token };

    let videoToken: string | undefined;
    let thumbnailUrl: string | undefined;

    if (opts.mediaUrls?.length) {
      const videoUrl = opts.mediaUrls[0];
      const thumbUrl = opts.mediaUrls[1] || opts.mediaUrls[0];

      // Upload thumbnail
      try {
        const thumbRes = await axios.get(thumbUrl, { responseType: 'arraybuffer', timeout: 30000 });
        const thumbForm = new FormData();
        thumbForm.append('file', Buffer.from(thumbRes.data), { filename: 'thumbnail.jpg', contentType: 'image/jpeg' });
        const thumbUpload = await axios.post('https://openapi.zalo.me/v2.0/oa/upload/image', thumbForm, {
          headers: { ...headers, ...thumbForm.getHeaders() },
        });
        if (thumbUpload.data?.error === 0) {
          thumbnailUrl = thumbUpload.data?.data?.url;
        } else {
          this.logger.warn(`[Zalo] Thumbnail upload error: ${JSON.stringify(thumbUpload.data)}`);
        }
      } catch (err: any) {
        this.logger.warn(`[Zalo] Thumbnail upload failed: ${err.message}`);
      }

      // Upload video — stream trực tiếp thay vì load cả vào RAM để tránh OOM
      try {
        const videoStream = await axios.get(videoUrl, { responseType: 'stream', timeout: 120000 });
        const videoForm = new FormData();
        videoForm.append('file', videoStream.data, { filename: 'video.mp4', contentType: 'video/mp4' });
        const videoUpload = await axios.post('https://openapi.zalo.me/v2.0/oa/upload/video', videoForm, {
          headers: { ...headers, ...videoForm.getHeaders() },
        });
        if (videoUpload.data?.error === 0) {
          videoToken = videoUpload.data?.data?.token;
        } else {
          throw new Error(`Zalo video upload failed: ${JSON.stringify(videoUpload.data)}`);
        }
      } catch (err: any) {
        throw new Error(`Zalo video upload error: ${err.message}`);
      }
    }

    const articleBody: any = {
      type: 'video',
      title: opts.title.substring(0, 100),
      description: opts.description || opts.title,
      status: 'show',
      comment: 'show',
    };
    if (videoToken) articleBody.video_id = videoToken;
    if (thumbnailUrl) articleBody.avatar = thumbnailUrl;

    const articleRes = await axios.post('https://openapi.zalo.me/v2.0/article/create', articleBody, { headers });

    if (articleRes.data?.error !== 0) {
      throw new Error(`Zalo article create failed: ${JSON.stringify(articleRes.data)}`);
    }

    const rawId = articleRes.data?.data?.token || articleRes.data?.data?.article_id;
    if (!rawId) {
      throw new Error(`Zalo article created (error=0) nhưng thiếu token/article_id trong response: ${JSON.stringify(articleRes.data)}`);
    }
    const articleId = String(rawId);
    return { articleId };
  }
}
