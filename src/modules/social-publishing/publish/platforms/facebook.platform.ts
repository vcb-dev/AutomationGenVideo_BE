import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as FormData from 'form-data';
import { PrismaService } from '../../../../common/prisma/prisma.service';

const execFileAsync = promisify(execFile);

@Injectable()
export class FacebookPublisher {
  private readonly logger = new Logger(FacebookPublisher.name);
  private readonly BASE = 'https://graph.facebook.com/v21.0';

  constructor(private readonly prisma: PrismaService) {}

  async publish(token: string, opts: {
    message: string;
    pageId?: string;
    mediaUrls?: string[];
    privacy?: string;
    extraData?: any;
  }): Promise<{ postId: string; url: string }> {
    const extra = opts.extraData || {};

    const pageToken = token;
    const targetId = extra.pageId || opts.pageId || 'me';
    const isPagePost = extra.type === 'page' || !!extra.pageId || !!opts.pageId;

    this.logger.log(`[FB] Publish to targetId=${targetId}, isPage=${isPagePost}, hasMedia=${(opts.mediaUrls?.length || 0) > 0}`);

    const privacyParam = (!isPagePost && opts.privacy)
      ? JSON.stringify({ value: opts.privacy })
      : undefined;

    // ── No media → text post ───────────────────────────────────────
    if (!opts.mediaUrls?.length) {
      const body: any = { message: opts.message, access_token: pageToken };
      if (privacyParam) body.privacy = privacyParam;
      const res = await axios.post(`${this.BASE}/${targetId}/feed`, body, { timeout: 60000 });
      const id = res.data.id;
      return { postId: id, url: `https://facebook.com/${id}` };
    }

    const firstMedia = opts.mediaUrls[0];
    const isVideo = /\.mp4(\?|$)/i.test(firstMedia);

    // ── Video ──────────────────────────────────────────────────────
    if (isVideo) {
      const localFilePath = this.resolveLocalFilePath(firstMedia);
      let videoId: string;

      if (localFilePath) {
        videoId = await this.uploadVideoResumable(localFilePath, targetId, pageToken, opts.message, privacyParam);
      } else {
        this.logger.log(`[FB] Uploading video via file_url: ${firstMedia}`);
        const body: any = { file_url: firstMedia, description: opts.message, access_token: pageToken };
        if (privacyParam) body.privacy = privacyParam;
        const res = await axios.post(`${this.BASE}/${targetId}/videos`, body, { timeout: 60000 });
        videoId = res.data.id;
      }

      // Upload thumbnail bất đồng bộ — không block publish
      setImmediate(() =>
        this.uploadThumbnailAsync(videoId, firstMedia, localFilePath, pageToken)
          .catch((e: any) => this.logger.warn(`[FB] uploadThumbnailAsync error: ${e.message}`)),
      );

      return { postId: videoId, url: `https://facebook.com/${videoId}` };
    }

    // ── Single image ───────────────────────────────────────────────
    if (opts.mediaUrls.length === 1) {
      const body: any = { url: firstMedia, caption: opts.message, access_token: pageToken };
      if (privacyParam) body.privacy = privacyParam;
      const res = await axios.post(`${this.BASE}/${targetId}/photos`, body, { timeout: 60000 });
      const id = res.data.post_id || res.data.id;
      return { postId: id, url: `https://facebook.com/${id}` };
    }

    // ── Multiple images → Carousel ─────────────────────────────────
    const photoResults = await Promise.allSettled(
      opts.mediaUrls.map(url =>
        axios.post(`${this.BASE}/${targetId}/photos`, { url, published: false, access_token: pageToken }, { timeout: 60000 }),
      ),
    );
    const photoIds: string[] = [];
    photoResults.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.data?.id) {
        photoIds.push(r.value.data.id);
      } else {
        const reason = r.status === 'rejected'
          ? (r.reason?.response?.data?.error?.message || r.reason?.message)
          : 'no id returned';
        this.logger.warn(`[FB] Photo upload failed for url[${i}]: ${reason}`);
      }
    });
    if (photoIds.length === 0) throw new Error('Tất cả ảnh upload thất bại');

    const feedBody: any = {
      message: opts.message,
      attached_media: JSON.stringify(photoIds.map((id) => ({ media_fbid: id }))),
      access_token: pageToken,
    };
    if (privacyParam) feedBody.privacy = privacyParam;
    const res = await axios.post(`${this.BASE}/${targetId}/feed`, feedBody, { timeout: 60000 });
    const id = res.data.id;
    return { postId: id, url: `https://facebook.com/${id}` };
  }

  private async uploadThumbnailAsync(
    videoId: string,
    firstMedia: string,
    localFilePath: string | null,
    pageToken: string,
  ): Promise<void> {
    let buffer: Buffer | null = null;

    // 1. Lấy thumbnail từ DB
    try {
      const filename = firstMedia.split('/').pop()?.split('?')[0];
      if (filename) {
        let cleanId = filename;
        if (cleanId.startsWith('gd_') && cleanId.includes('_')) {
          cleanId = cleanId.split('_').slice(2).join('_').replace(/\.mp4$/i, '');
        } else if (cleanId.includes('_')) {
          cleanId = cleanId.split('_').slice(1).join('_').replace(/\.mp4$/i, '');
        }
        const uploadedFile = await this.prisma.socialUploadedFile.findFirst({
          where: { OR: [{ filename }, { drive_file_id: cleanId }, { url: firstMedia }] },
        });
        if (uploadedFile?.thumbnail_url) {
          this.logger.log(`[FB] Tải thumbnail từ DB: ${uploadedFile.thumbnail_url}`);
          const res = await axios.get(uploadedFile.thumbnail_url, { responseType: 'arraybuffer', timeout: 15000 });
          buffer = Buffer.from(res.data);
        }
      }
    } catch (e: any) {
      this.logger.warn(`[FB] Lỗi lấy thumbnail từ DB: ${e.message}`);
    }

    // 2. Fallback: FFmpeg cắt từ file local
    if (!buffer && localFilePath) {
      const ffmpegPath = process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)
        ? process.env.FFMPEG_PATH
        : fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : null;

      if (ffmpegPath) {
        try {
          const { stdout } = await execFileAsync(
            ffmpegPath,
            ['-ss', '00:00:00', '-i', localFilePath, '-vframes', '1', '-q:v', '2', '-f', 'image2', '-'],
            { maxBuffer: 10 * 1024 * 1024, encoding: 'buffer' } as any,
          );
          buffer = stdout as unknown as Buffer;
        } catch (e: any) {
          this.logger.warn(`[FB] FFmpeg thumbnail error: ${e.message}`);
        }
      }
    }

    if (!buffer || buffer.length === 0) {
      this.logger.warn('[FB] Không có thumbnail để upload');
      return;
    }

    const thumbForm = new FormData();
    thumbForm.append('is_preferred', 'true');
    thumbForm.append('source', buffer, { filename: 'cover.jpg', contentType: 'image/jpeg' });

    this.logger.log(`[FB] Uploading thumbnail cho video ${videoId} (${buffer.length} bytes)`);
    await axios.post(`${this.BASE}/${videoId}/thumbnails`, thumbForm, {
      headers: thumbForm.getHeaders(),
      params: { access_token: pageToken },
      timeout: 60000,
    });
    this.logger.log(`[FB] ✅ Thumbnail set cho video ${videoId}`);
  }

  private async uploadVideoResumable(
    localFilePath: string,
    targetId: string,
    pageToken: string,
    description: string,
    privacyParam?: string,
  ): Promise<string> {
    const fileSize = fs.statSync(localFilePath).size;
    this.logger.log(`[FB] Resumable upload start: ${localFilePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

    const startRes = await axios.post(`${this.BASE}/${targetId}/videos`, null, {
      params: { upload_phase: 'start', file_size: fileSize, access_token: pageToken },
      timeout: 60000,
    });
    const { upload_session_id, video_id } = startRes.data;
    let currentStart: number = parseInt(startRes.data.start_offset, 10);
    let currentEnd: number = parseInt(startRes.data.end_offset, 10);
    this.logger.log(`[FB] Session=${upload_session_id}, videoId=${video_id}`);

    const fd = fs.openSync(localFilePath, 'r');
    let chunkBuf = Buffer.allocUnsafe(Math.max(currentEnd - currentStart, 4 * 1024 * 1024));
    try {
      while (currentStart < fileSize) {
        const chunkSize = currentEnd - currentStart;
        if (chunkSize > chunkBuf.length) chunkBuf = Buffer.allocUnsafe(chunkSize);
        const buf = chunkBuf.subarray(0, chunkSize);
        fs.readSync(fd, buf, 0, chunkSize, currentStart);

        const form = new FormData();
        form.append('upload_phase', 'transfer');
        form.append('upload_session_id', upload_session_id);
        form.append('start_offset', String(currentStart));
        form.append('access_token', pageToken);
        form.append('video_file_chunk', buf, { filename: 'chunk.mp4', contentType: 'video/mp4' });

        const pct = ((currentStart / fileSize) * 100).toFixed(0);
        this.logger.log(`[FB] Chunk ${pct}% (${(currentStart / 1024 / 1024).toFixed(1)}-${(currentEnd / 1024 / 1024).toFixed(1)} MB)`);
        const t0 = Date.now();
        const transferRes = await axios.post(`${this.BASE}/${targetId}/videos`, form, {
          headers: form.getHeaders(),
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 180000,
        });
        const mbps = (chunkSize / 1024 / 1024 / ((Date.now() - t0) / 1000)).toFixed(1);
        this.logger.log(`[FB] Chunk done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${mbps} MB/s)`);
        currentStart = parseInt(transferRes.data.start_offset, 10);
        currentEnd = parseInt(transferRes.data.end_offset, 10);
      }
    } finally {
      fs.closeSync(fd);
    }

    const finishBody: any = { upload_phase: 'finish', upload_session_id, description, access_token: pageToken };
    if (privacyParam) finishBody.privacy = privacyParam;
    await axios.post(`${this.BASE}/${targetId}/videos`, finishBody, { timeout: 60000 });

    this.logger.log(`[FB] Resumable upload complete: videoId=${video_id}`);
    return video_id;
  }

  private resolveLocalFilePath(mediaUrl: string): string | null {
    if (!mediaUrl.includes('/api/social/media/')) return null;
    const raw = mediaUrl.split('/api/social/media/').pop()?.split('?')[0];
    if (!raw) return null;
    const filename = path.basename(raw);
    if (!filename) return null;
    const uploadBase = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');
    const filePath = path.join(uploadBase, filename);
    return fs.existsSync(filePath) ? filePath : null;
  }
}
