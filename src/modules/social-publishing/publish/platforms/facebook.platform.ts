import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { FACEBOOK_GRAPH_BASE } from '../../platform-api.const';
import { CAROUSEL_MAX_ITEMS } from '../../platform-limits.const';
import { withRetry, DEFAULT_MAX_ATTEMPTS } from '../retry.util';
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
  private readonly BASE = FACEBOOK_GRAPH_BASE;

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
      let res: any;
      try {
        res = await axios.post(`${this.BASE}/${targetId}/feed`, body, { timeout: 60000 });
      } catch (err: any) {
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`Facebook text post failed: ${detail}`);
      }
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
        let res: any;
        try {
          res = await axios.post(`${this.BASE}/${targetId}/videos`, body, { timeout: 60000 });
        } catch (err: any) {
          const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
          throw new Error(`Facebook video upload (file_url) failed: ${detail}`);
        }
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
      const extraFields: Record<string, string> = { caption: opts.message };
      if (privacyParam) extraFields.privacy = privacyParam;
      let res: any;
      try {
        res = await this.postPhoto(firstMedia, targetId, pageToken, extraFields);
      } catch (err: any) {
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`Facebook single image post failed: ${detail}`);
      }
      const id = res.data.post_id || res.data.id;
      return { postId: id, url: `https://facebook.com/${id}` };
    }

    // ── Multiple images → Carousel ─────────────────────────────────
    // Upload tuần tự (không bắn đồng thời) + retry từng ảnh. Khi file là local
    // (/api/social/media/...) thì upload thẳng bytes lên Facebook thay vì đưa URL
    // để Facebook tự tải — tránh lỗi code 100 "Invalid parameter" khi server fetch
    // của Facebook không tải được URL Railway lúc nhiều bài đăng đồng thời.
    if (opts.mediaUrls.length > CAROUSEL_MAX_ITEMS) {
      throw new Error(
        `Facebook chỉ nhận tối đa ${CAROUSEL_MAX_ITEMS} media trong một bài — nhận ${opts.mediaUrls.length}. ` +
        `Trước đây các ảnh thừa vẫn được upload rồi mới bị từ chối, để lại ảnh mồ côi trên Page.`,
      );
    }

    const photoIds: string[] = [];
    const failReasons: string[] = [];
    for (let i = 0; i < opts.mediaUrls.length; i++) {
      const url = opts.mediaUrls[i];
      try {
        const id = await this.uploadCarouselPhotoWithRetry(url, targetId, pageToken);
        photoIds.push(id);
      } catch (e: any) {
        // Log FULL response data (kèm error_subcode, fbtrace_id) để chẩn đoán chính xác
        const reason = e?.response?.data ? JSON.stringify(e.response.data) : e?.message;
        failReasons.push(`url[${i}]: ${reason}`);
        this.logger.warn(`[FB] Photo upload failed for url[${i}] sau khi retry: ${reason}`);
      }
      if (i < opts.mediaUrls.length - 1) await this.sleep(400);
    }
    if (photoIds.length === 0) throw new Error(`Tất cả ảnh upload thất bại — ${failReasons.join('; ')}`);
    if (failReasons.length > 0) {
      // Không đăng thiếu ảnh một cách âm thầm — ném lỗi để hệ thống retry cả bài,
      // tránh trường hợp carousel hiển thị thiếu ảnh trên Facebook mà không ai biết.
      throw new Error(
        `Chỉ upload thành công ${photoIds.length}/${opts.mediaUrls.length} ảnh lên Facebook — ${failReasons.join('; ')}`,
      );
    }

    const feedBody: any = {
      message: opts.message,
      attached_media: JSON.stringify(photoIds.map((id) => ({ media_fbid: id }))),
      access_token: pageToken,
    };
    if (privacyParam) feedBody.privacy = privacyParam;
    let res: any;
    try {
      res = await axios.post(`${this.BASE}/${targetId}/feed`, feedBody, { timeout: 60000 });
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Facebook carousel feed post failed: ${detail}`);
    }
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
    try {
      await axios.post(`${this.BASE}/${videoId}/thumbnails`, thumbForm, {
        headers: thumbForm.getHeaders(),
        params: { access_token: pageToken },
        timeout: 60000,
      });
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Facebook thumbnail upload failed: ${detail}`);
    }
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

    let startRes: any;
    try {
      startRes = await axios.post(`${this.BASE}/${targetId}/videos`, null, {
        params: { upload_phase: 'start', file_size: fileSize, access_token: pageToken },
        timeout: 60000,
      });
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Facebook resumable upload (start) failed: ${detail}`);
    }
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
        let transferRes: any;
        try {
          transferRes = await axios.post(`${this.BASE}/${targetId}/videos`, form, {
            headers: form.getHeaders(),
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 180000,
          });
        } catch (err: any) {
          const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
          throw new Error(`Facebook resumable upload (chunk ${pct}%) failed: ${detail}`);
        }
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
    try {
      await axios.post(`${this.BASE}/${targetId}/videos`, finishBody, { timeout: 60000 });
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Facebook resumable upload (finish) failed: ${detail}`);
    }

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

  /**
   * Đăng 1 ảnh lên /photos. Nếu file là local (/api/social/media/...) thì upload
   * thẳng bytes (multipart `source`) để Facebook không phải tự tải URL của ta —
   * loại bỏ lỗi "Invalid parameter" do server FB fetch URL Railway bị timeout.
   * Nếu không phải local (vd: Drive direct URL) thì fallback về cách đưa `url`.
   */
  private async postPhoto(
    mediaUrl: string,
    targetId: string,
    pageToken: string,
    extraFields: Record<string, string>,
    timeout = 120000,
  ): Promise<any> {
    const localPath = this.resolveLocalFilePath(mediaUrl);
    if (localPath) {
      const form = new FormData();
      for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
      form.append('access_token', pageToken);
      form.append('source', fs.createReadStream(localPath), { filename: path.basename(localPath) });
      return axios.post(`${this.BASE}/${targetId}/photos`, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout,
      });
    }
    return axios.post(
      `${this.BASE}/${targetId}/photos`,
      { url: mediaUrl, ...extraFields, access_token: pageToken },
      { timeout },
    );
  }

  private async uploadCarouselPhotoWithRetry(
    url: string,
    targetId: string,
    pageToken: string,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  ): Promise<string> {
    return withRetry(async () => {
      const res = await this.postPhoto(url, targetId, pageToken, { published: 'false' });
      if (!res.data?.id) throw new Error('no id returned');
      return res.data.id as string;
    }, {
      maxAttempts,
      onRetry: (e, attempt, wait) =>
        this.logger.warn(`[FB] Upload ảnh lỗi (lượt ${attempt}), thử lại sau ${wait}ms: ${e.message}`),
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
