import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as FormData from 'form-data';

const execAsync = promisify(exec);

@Injectable()
export class FacebookPublisher {
  private readonly logger = new Logger(FacebookPublisher.name);
  private readonly BASE = 'https://graph.facebook.com/v21.0';

  async publish(token: string, opts: {
    message: string;
    pageId?: string;
    mediaUrls?: string[];
    privacy?: string;
    extraData?: any;
  }): Promise<{ postId: string; url: string }> {
    const extra = opts.extraData || {};

    // Token đã được mã hoá và lưu trong access_token_enc — không còn dùng extra.pageToken
    const pageToken = token;
    const targetId = extra.pageId || opts.pageId || 'me';
    const isPagePost = extra.type === 'page' || !!extra.pageId || !!opts.pageId;

    this.logger.log(`[FB] Publish to targetId=${targetId}, isPage=${isPagePost}, hasMedia=${(opts.mediaUrls?.length || 0) > 0}`);

    // Privacy: chỉ áp dụng cho personal feed, KHÔNG cho Page posts
    const privacyParam = (!isPagePost && opts.privacy)
      ? JSON.stringify({ value: opts.privacy })
      : undefined;

    // ── No media → text post ───────────────────────────────────────
    if (!opts.mediaUrls?.length) {
      const body: any = {
        message: opts.message,
        access_token: pageToken,
      };
      if (privacyParam) body.privacy = privacyParam;

      const res = await axios.post(`${this.BASE}/${targetId}/feed`, body);
      const id = res.data.id;
      return { postId: id, url: `https://facebook.com/${id}` };
    }

    const firstMedia = opts.mediaUrls[0];
    const isVideo = /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(firstMedia);

    // ── Video ──────────────────────────────────────────────────────
    if (isVideo) {
      const localFilePath = this.resolveLocalFilePath(firstMedia);
      let videoId: string;

      if (localFilePath) {
        // Multipart upload trực tiếp từ disk — không cần URL công khai, không phụ thuộc ngrok/catbox
        this.logger.log(`[FB] Uploading video via multipart from disk: ${localFilePath}`);
        const form = new FormData();
        form.append('source', fs.createReadStream(localFilePath), { filename: 'video.mp4', contentType: 'video/mp4' });
        form.append('description', opts.message);
        form.append('access_token', pageToken);
        if (privacyParam) form.append('privacy', privacyParam);

        const res = await axios.post(`${this.BASE}/${targetId}/videos`, form, {
          headers: form.getHeaders(),
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 600000,
        });
        videoId = res.data.id;
      } else {
        // Fallback: file_url cho external URLs (catbox, CDN, ...)
        this.logger.log(`[FB] Uploading video via file_url: ${firstMedia}`);
        const body: any = {
          file_url: firstMedia,
          description: opts.message,
          access_token: pageToken,
        };
        if (privacyParam) body.privacy = privacyParam;
        const res = await axios.post(`${this.BASE}/${targetId}/videos`, body);
        videoId = res.data.id;
      }

      // ── TỰ ĐỘNG TRÍCH XUẤT ẢNH BÌA (FRAME ĐẦU) & ĐẶT LÀM THUMBNAIL ──
      try {
        const ffmpegPath = process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)
          ? process.env.FFMPEG_PATH
          : fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : null;
        if (!ffmpegPath) {
          this.logger.warn('[FB] FFmpeg không tìm thấy — bỏ qua bước set thumbnail');
          return { postId: videoId, url: `https://facebook.com/${videoId}` };
        }

        // Chỉ trích xuất thumbnail từ file local để tránh command injection với external URL
        if (!localFilePath) {
          this.logger.log('[FB] Bỏ qua thumbnail vì không có local file');
          return { postId: videoId, url: `https://facebook.com/${videoId}` };
        }
        this.logger.log(`[FB] Extracting first frame for thumbnail from: ${localFilePath}`);

        const cmd = `"${ffmpegPath}" -ss 00:00:00 -i "${localFilePath}" -vframes 1 -q:v 2 -f image2 -`;
        const { stdout: buffer } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024, encoding: 'buffer' } as any);

        if (buffer && buffer.length > 0) {
          const thumbForm = new FormData();
          thumbForm.append('is_preferred', 'true');
          thumbForm.append('source', buffer, { filename: 'cover.jpg', contentType: 'image/jpeg' });

          this.logger.log(`[FB] Uploading extracted thumbnail to video ${videoId} (${buffer.length} bytes)`);
          await axios.post(`${this.BASE}/${videoId}/thumbnails`, thumbForm, {
            headers: thumbForm.getHeaders(),
            params: { access_token: pageToken },
          });
          this.logger.log(`[FB] Successfully set custom thumbnail for video ${videoId}`);
        }
      } catch (err: any) {
        this.logger.warn(`[FB] Failed to set custom thumbnail: ${err.message}`);
      }

      return { postId: videoId, url: `https://facebook.com/${videoId}` };
    }

    // ── Single image ───────────────────────────────────────────────
    if (opts.mediaUrls.length === 1) {
      const body: any = {
        url: firstMedia,
        caption: opts.message,
        access_token: pageToken,
      };
      if (privacyParam) body.privacy = privacyParam;

      const res = await axios.post(`${this.BASE}/${targetId}/photos`, body);
      const id = res.data.post_id || res.data.id;
      return { postId: id, url: `https://facebook.com/${id}` };
    }

    // ── Multiple images → Carousel ─────────────────────────────────
    // Bước 1: upload từng ảnh dưới dạng unpublished
    const photoIds: string[] = [];
    for (const url of opts.mediaUrls) {
      try {
        const r = await axios.post(`${this.BASE}/${targetId}/photos`, {
          url,
          published: false,
          access_token: pageToken,
        });
        if (r.data?.id) {
          photoIds.push(r.data.id);
        } else {
          this.logger.warn(`[FB] Photo upload returned no id for url: ${url}`);
        }
      } catch (err: any) {
        this.logger.warn(`[FB] Photo upload failed: ${err.response?.data?.error?.message || err.message}`);
      }
    }
    if (photoIds.length === 0) throw new Error('Tất cả ảnh upload thất bại');

    // Bước 2: post carousel
    const feedBody: any = {
      message: opts.message,
      attached_media: JSON.stringify(photoIds.map((id) => ({ media_fbid: id }))),
      access_token: pageToken,
    };
    if (privacyParam) feedBody.privacy = privacyParam;

    const res = await axios.post(`${this.BASE}/${targetId}/feed`, feedBody);
    const id = res.data.id;
    return { postId: id, url: `https://facebook.com/${id}` };
  }

  private resolveLocalFilePath(mediaUrl: string): string | null {
    if (!mediaUrl.includes('/api/social/media/')) return null;
    const raw = mediaUrl.split('/api/social/media/').pop()?.split('?')[0];
    if (!raw) return null;
    // path.basename() ngăn path traversal (e.g. ../../etc/passwd)
    const filename = path.basename(raw);
    if (!filename) return null;
    const uploadBase = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');
    const filePath = path.join(uploadBase, filename);
    return fs.existsSync(filePath) ? filePath : null;
  }
}
