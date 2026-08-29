import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as FormData from 'form-data';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { isVideoUrl } from '../media-url.util';
import { probeMedia, resolveFFmpegPath, FACEBOOK_REELS_LIMITS } from '../media-probe.util';

const execFileAsync = promisify(execFile);

@Injectable()
export class FacebookPublisher {
  private readonly logger = new Logger(FacebookPublisher.name);
  private readonly BASE = 'https://graph.facebook.com/v21.0';
  private readonly RUPLOAD_BASE = 'https://rupload.facebook.com/video-upload/v21.0';

  constructor(private readonly prisma: PrismaService) {}

  async publish(token: string, opts: {
    message: string;
    pageId?: string;
    mediaUrls?: string[];
    privacy?: string;
    extraData?: any;
    /** Thời lượng đã đo ở cổng kiểm tra; thiếu thì tự probe */
    videoDurationSec?: number | null;
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
    const isVideo = isVideoUrl(firstMedia);

    // Graph API không đăng được video chung với media khác trong một bài. Trước đây
    // code chỉ xét mediaUrls[0] rồi return ngay ở nhánh video → các media còn lại bị
    // bỏ im lặng: người dùng thấy "đăng thành công" nhưng bài thiếu nội dung.
    if (opts.mediaUrls.length > 1 && opts.mediaUrls.some(isVideoUrl)) {
      throw new Error(
        `Facebook không đăng được video chung với media khác trong cùng một bài — ` +
        `nhận ${opts.mediaUrls.length} media, trong đó có video. Hãy tách thành các bài riêng.`,
      );
    }

    // ── Video ──────────────────────────────────────────────────────
    if (isVideo) {
      const localFilePath = this.resolveLocalFilePath(firstMedia);
      let videoId: string;

      // Reels feed là nguồn hiển thị cho người chưa follow Page; /videos chỉ tới
      // người đã follow. Video đủ điều kiện (3–90s theo docs Meta) phải đi qua
      // /video_reels, không thì mất hẳn nhánh phân phối đó.
      // Cổng kiểm tra ở PublishService đã probe rồi — dùng lại thay vì chạy ffprobe
      // lần hai cho cùng một file. Tự probe chỉ khi được gọi thẳng, không qua cổng.
      const durationSec = opts.videoDurationSec !== undefined
        ? opts.videoDurationSec
        : (await probeMedia(localFilePath ?? firstMedia))?.durationSec ?? null;
      const eligibleForReels =
        durationSec !== null &&
        durationSec >= FACEBOOK_REELS_LIMITS.minSec &&
        durationSec <= FACEBOOK_REELS_LIMITS.maxSec;

      if (eligibleForReels) {
        this.logger.log(`[FB] Video ${durationSec!.toFixed(1)}s → đăng dạng Reel`);
        videoId = await this.uploadReel(targetId, pageToken, opts.message, firstMedia, localFilePath);
        setImmediate(() =>
          this.uploadThumbnailAsync(videoId, firstMedia, localFilePath, pageToken)
            .catch((e: any) => this.logger.warn(`[FB] uploadThumbnailAsync error: ${e.message}`)),
        );
        return { postId: videoId, url: `https://facebook.com/reel/${videoId}` };
      }

      this.logger.log(
        `[FB] Video ${durationSec === null ? 'không đọc được thời lượng' : `${durationSec.toFixed(1)}s`}` +
        ` → đăng dạng video thường (ngoài khoảng ${FACEBOOK_REELS_LIMITS.minSec}-${FACEBOOK_REELS_LIMITS.maxSec}s của Reels)`,
      );

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
      setImmediate(() => this.uploadThumbnailWithRetry(videoId, firstMedia, localFilePath, pageToken));

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
      //
      // Dọn ảnh đã upload trước khi ném: chúng đang ở trạng thái published=false,
      // không hiện trong bài nào nhưng vẫn nằm trên Page. Mỗi lần retry lại đẻ thêm
      // một bộ nữa, tích tụ dần thành ảnh mồ côi không ai xoá.
      await this.deleteOrphanPhotos(photoIds, pageToken);
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
      // Ảnh đã upload nhưng bài không tạo được → cũng thành mồ côi, dọn luôn.
      await this.deleteOrphanPhotos(photoIds, pageToken);
      throw new Error(`Facebook carousel feed post failed: ${detail}`);
    }
    const id = res.data.id;
    return { postId: id, url: `https://facebook.com/${id}` };
  }

  /**
   * Xoá ảnh đã upload nhưng chưa gắn vào bài nào.
   *
   * Chỉ cố gắng hết sức: xoá không được thì ghi log chứ không che mất lỗi gốc —
   * lỗi gốc mới là thứ người dùng cần thấy.
   */
  private async deleteOrphanPhotos(photoIds: string[], pageToken: string): Promise<void> {
    for (const id of photoIds) {
      try {
        await axios.delete(`${this.BASE}/${id}`, {
          params: { access_token: pageToken },
          timeout: 15000,
        });
        this.logger.log(`[FB] Đã dọn ảnh mồ côi ${id}`);
      } catch (e: any) {
        const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
        this.logger.warn(`[FB] Không xoá được ảnh mồ côi ${id}: ${detail}`);
      }
    }
  }

  /**
   * Đăng Reel qua Reels API — 3 pha theo docs Meta:
   *   1. POST /{page-id}/video_reels?upload_phase=start   → video_id + upload_url
   *   2. POST rupload.facebook.com/video-upload/{video_id} → nạp bytes hoặc header file_url
   *   3. POST /{page-id}/video_reels?upload_phase=finish  → video_state=PUBLISHED
   *
   * Khác hẳn luồng /videos: pha 2 nằm trên host rupload, xác thực bằng header
   * `Authorization: OAuth <token>` chứ không phải query param access_token.
   */
  private async uploadReel(
    targetId: string,
    pageToken: string,
    description: string,
    mediaUrl: string,
    localFilePath: string | null,
  ): Promise<string> {
    // ── Pha 1: khởi tạo ──────────────────────────────────────────────
    let startRes: any;
    try {
      startRes = await axios.post(`${this.BASE}/${targetId}/video_reels`, null, {
        params: { upload_phase: 'start', access_token: pageToken },
        timeout: 60000,
      });
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Facebook reel upload (start) failed: ${detail}`);
    }

    const videoId: string = startRes.data.video_id;
    if (!videoId) {
      throw new Error(`Facebook reel upload (start) không trả về video_id: ${JSON.stringify(startRes.data)}`);
    }
    // Docs trả kèm upload_url; tự dựng chỉ là đường lui khi thiếu.
    const uploadUrl: string = startRes.data.upload_url || `${this.RUPLOAD_BASE}/${videoId}`;
    this.logger.log(`[FB] Reel session videoId=${videoId}`);

    // ── Pha 2: nạp video ─────────────────────────────────────────────
    // Ưu tiên nạp bytes khi có file local — server Facebook từng tải URL Railway
    // thất bại lúc nhiều bài đăng đồng thời (xem ghi chú ở nhánh carousel ảnh).
    try {
      if (localFilePath) {
        const fileSize = fs.statSync(localFilePath).size;
        this.logger.log(`[FB] Reel upload bytes: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);
        await axios.post(uploadUrl, fs.createReadStream(localFilePath), {
          headers: {
            Authorization: `OAuth ${pageToken}`,
            offset: '0',
            file_size: String(fileSize),
            'Content-Type': 'application/octet-stream',
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 300000,
        });
      } else {
        this.logger.log(`[FB] Reel upload qua file_url: ${mediaUrl}`);
        await axios.post(uploadUrl, null, {
          headers: { Authorization: `OAuth ${pageToken}`, file_url: mediaUrl },
          timeout: 300000,
        });
      }
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Facebook reel upload (transfer) failed: ${detail}`);
    }

    // ── Pha 3: xuất bản ──────────────────────────────────────────────
    try {
      await axios.post(`${this.BASE}/${targetId}/video_reels`, null, {
        params: {
          video_id: videoId,
          upload_phase: 'finish',
          video_state: 'PUBLISHED',
          description,
          access_token: pageToken,
        },
        timeout: 60000,
      });
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Facebook reel upload (finish) failed: ${detail}`);
    }

    this.logger.log(`[FB] ✅ Reel published videoId=${videoId}`);
    return videoId;
  }

  /**
   * Gọi uploadThumbnailAsync có thử lại.
   *
   * Chạy ngay sau khi đăng thì Facebook thường chưa xử lý xong video và trả lỗi;
   * bản cũ bắn một lần rồi quên, ảnh bìa im lặng không bao giờ được đặt. Giãn dần
   * 5s → 15s → 30s để đợi video xử lý xong.
   */
  private async uploadThumbnailWithRetry(
    videoId: string,
    firstMedia: string,
    localFilePath: string | null,
    pageToken: string,
    maxAttempts = 3,
  ): Promise<void> {
    const delaysMs = [5000, 15000, 30000];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.sleep(delaysMs[Math.min(attempt, delaysMs.length - 1)]);
      try {
        await this.uploadThumbnailAsync(videoId, firstMedia, localFilePath, pageToken);
        return;
      } catch (e: any) {
        const isLast = attempt === maxAttempts - 1;
        this.logger.warn(
          `[FB] Đặt ảnh bìa cho ${videoId} thất bại (lần ${attempt + 1}/${maxAttempts})` +
          `${isLast ? ' — bỏ cuộc, video vẫn đăng bình thường' : ', sẽ thử lại'}: ${e.message}`,
        );
      }
    }
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
      // Dùng bản dò chung — bản cũ ở đây bỏ sót fallback @ffmpeg-installer nên trên
      // máy không có /usr/bin/ffmpeg thì lặng lẽ không cắt được ảnh bìa.
      const ffmpegPath = resolveFFmpegPath();

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
    maxAttempts = 3,
  ): Promise<string> {
    let lastErr: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.postPhoto(url, targetId, pageToken, { published: 'false' });
        if (res.data?.id) return res.data.id;
        throw new Error('no id returned');
      } catch (e: any) {
        lastErr = e;
        const status = e?.response?.status;
        // Chỉ retry lỗi tạm thời: rate limit (429), lỗi server FB (5xx), hoặc không có status (timeout/network)
        const retryable = !status || status === 429 || status >= 500;
        if (attempt < maxAttempts && retryable) {
          await this.sleep(attempt * 800);
          continue;
        }
        break;
      }
    }
    throw lastErr;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
