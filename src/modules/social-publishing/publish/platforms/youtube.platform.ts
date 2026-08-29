import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { YOUTUBE_UPLOAD_BASE } from '../../platform-api.const';
import { YOUTUBE_TITLE_MAX } from '../youtube-metadata.util';

function parseContentLength(raw: unknown): number {
  const size = raw ? parseInt(String(raw), 10) : 0;
  return Number.isFinite(size) && size > 0 ? size : 0;
}

@Injectable()
export class YoutubePublisher {
  private readonly logger = new Logger(YoutubePublisher.name);

  async publish(token: string, opts: {
    title: string; description?: string; privacy?: string; mediaUrls: string[];
    tags?: string[];
    thumbUrl?: string;
    refreshToken?: string; tokenExpiresAt?: Date;
    onTokenRefreshed?: (newToken: string, expiresAt: Date) => void;
  }): Promise<{ videoId: string; url: string }> {
    if (!opts.mediaUrls?.length) throw new Error('YouTube yêu cầu video file');
    const videoUrl = opts.mediaUrls[0];

    // Chỉ refresh khi token hết hạn hoặc sắp hết hạn trong 5 phút
    let accessToken = token;
    const needsRefresh = opts.refreshToken && (
      !opts.tokenExpiresAt || opts.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000
    );
    if (needsRefresh) {
      try {
        const refreshed = await this.refreshAccessToken(opts.refreshToken!);
        accessToken = refreshed.accessToken;
        opts.onTokenRefreshed?.(refreshed.accessToken, refreshed.tokenExpiresAt);
        this.logger.log('[YouTube] Token refreshed OK');
      } catch (e: any) {
        this.logger.warn(`[YouTube] Token refresh failed, using existing: ${e.message}`);
      }
    }

    const VALID_PRIVACY = ['public', 'private', 'unlisted'];
    const privacyStatus = VALID_PRIVACY.includes(opts.privacy || '') ? opts.privacy : 'public';

    const metadata = {
      snippet: {
        title: (opts.title || 'Video').substring(0, YOUTUBE_TITLE_MAX),
        description: opts.description || '',
        tags: opts.tags ?? [],
      },
      status: { privacyStatus },
    };

    // Mở luồng tải TRƯỚC rồi lấy kích thước từ chính response đó.
    //
    // Bản cũ đo kích thước bằng HEAD (hoặc GET Range) rồi mở một GET khác để tải:
    // hai request riêng biệt có thể trả kích thước khác nhau (Drive redirect, CDN
    // đổi bản) → Content-Length khai với YouTube lệch với số byte thực gửi đi,
    // upload hỏng hoặc cụt. Một nguồn duy nhất thì không còn cửa lệch.
    let videoStream = await this.openVideoStream(videoUrl);
    let fileSize = parseContentLength(videoStream.headers['content-length']);

    if (fileSize === 0) {
      // Nguồn không khai content-length — quay lại cách đo riêng, chấp nhận rủi ro cũ.
      videoStream.data?.destroy?.();
      fileSize = await this.probeFileSize(videoUrl);
      if (fileSize === 0) {
        throw new Error(`YouTube: không lấy được kích thước file từ URL ${videoUrl}`);
      }
      videoStream = await this.openVideoStream(videoUrl);
    }

    // Initiate resumable upload session
    let initRes: any;
    try {
      initRes = await axios.post(
        `${YOUTUBE_UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status`,
        metadata,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': 'video/mp4',
            'X-Upload-Content-Length': fileSize,
          },
          timeout: 30000,
        },
      );
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`YouTube init upload session failed: ${detail}`);
    }
    const uploadUrl = initRes.headers.location;
    if (!uploadUrl) throw new Error('YouTube: không nhận được upload URL');

    const uploadRes = await this.uploadWithResume(
      uploadUrl, videoUrl, videoStream, fileSize, accessToken,
    );

    const videoId = uploadRes.data.id;
    if (!videoId) throw new Error('YouTube: upload thành công nhưng không nhận được video ID');

    // Upload thumbnail nếu có
    if (opts.thumbUrl) {
      try {
        const thumbRes = await axios.get(opts.thumbUrl, { responseType: 'stream', timeout: 30000 });
        const contentType = thumbRes.headers['content-type'] || 'image/jpeg';
        await axios.post(
          `${YOUTUBE_UPLOAD_BASE}/thumbnails/set?videoId=${videoId}&uploadType=media`,
          thumbRes.data,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': contentType,
            },
            timeout: 60000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
          },
        );
        this.logger.log(`[YouTube] Thumbnail đã được upload cho video ${videoId}`);
      } catch (e: any) {
        const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
        this.logger.warn(`[YouTube] Upload thumbnail thất bại (video vẫn OK): ${detail}`);
      }
    }

    return { videoId, url: `https://youtube.com/watch?v=${videoId}` };
  }

  /** Mở luồng tải video, tuỳ chọn bắt đầu từ một mốc byte để tiếp tục dở dang */
  private async openVideoStream(videoUrl: string, fromByte = 0): Promise<any> {
    return axios.get(videoUrl, {
      responseType: 'stream',
      timeout: 300000,
      ...(fromByte > 0 && { headers: { Range: `bytes=${fromByte}-` } }),
    });
  }

  /** Đo kích thước bằng HEAD, không được thì GET Range — chỉ dùng khi luồng tải không khai content-length */
  private async probeFileSize(videoUrl: string): Promise<number> {
    try {
      const headRes = await axios.head(videoUrl, { timeout: 15000 });
      const size = parseContentLength(headRes?.headers?.['content-length']);
      if (size > 0) return size;
    } catch (e: any) {
      this.logger.warn(`[YouTube] HEAD thất bại: ${e.message}, thử GET Range...`);
    }

    try {
      const rangeRes = await axios.get(videoUrl, {
        headers: { Range: 'bytes=0-0' },
        timeout: 15000,
      });
      const contentRange = rangeRes.headers['content-range'];
      if (contentRange) {
        const total = parseInt(String(contentRange).split('/').pop() || '0', 10);
        if (Number.isFinite(total) && total > 0) return total;
      }
      return parseContentLength(rangeRes.headers['content-length']);
    } catch (e: any) {
      this.logger.error(`[YouTube] GET Range thất bại: ${e.message}`);
      return 0;
    }
  }

  /**
   * Nạp video vào phiên resumable, tiếp tục từ mốc dở dang khi đứt giữa chừng.
   *
   * Bản cũ mở phiên `uploadType=resumable` nhưng PUT một phát toàn bộ stream —
   * đứt là mất trắng, phải upload lại từ đầu. Với video vài trăm MB trên Railway
   * thì đó là lỗi tốn kém.
   *
   * Cách tiếp tục theo giao thức Google: PUT rỗng kèm `Content-Range: bytes *\/<total>`
   * để hỏi đã nhận tới đâu, rồi mở lại nguồn từ đúng mốc đó. Nguồn nào không hỗ trợ
   * Range (không trả 206) thì dừng — không thể tiếp tục một cách an toàn.
   */
  private async uploadWithResume(
    uploadUrl: string,
    videoUrl: string,
    initialStream: any,
    fileSize: number,
    accessToken: string,
    maxAttempts = 3,
  ): Promise<any> {
    let stream = initialStream;
    let offset = 0;
    let lastErr: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await axios.put(uploadUrl, stream.data, {
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': fileSize - offset,
            ...(offset > 0 && { 'Content-Range': `bytes ${offset}-${fileSize - 1}/${fileSize}` }),
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 600000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        });
      } catch (err: any) {
        lastErr = err;
        try { stream?.data?.destroy?.(); } catch { /* luồng đã đóng */ }

        if (attempt >= maxAttempts) break;

        const received = await this.queryUploadOffset(uploadUrl, fileSize, accessToken);
        if (received === null) {
          this.logger.warn('[YouTube] Không hỏi được mốc đã nhận — dừng, không thử lại');
          break;
        }
        if (received >= fileSize) {
          this.logger.warn('[YouTube] Server báo đã nhận đủ nhưng không trả kết quả — dừng');
          break;
        }

        this.logger.warn(
          `[YouTube] Upload đứt ở ${(received / 1024 / 1024).toFixed(1)}/${(fileSize / 1024 / 1024).toFixed(1)} MB ` +
          `— tiếp tục (lần ${attempt + 1}/${maxAttempts})`,
        );

        const resumed = await this.openVideoStream(videoUrl, received);
        if (resumed.status !== 206) {
          try { resumed.data?.destroy?.(); } catch { /* luồng đã đóng */ }
          this.logger.warn('[YouTube] Nguồn không hỗ trợ Range — không tiếp tục được, dừng');
          break;
        }
        stream = resumed;
        offset = received;
      }
    }

    const detail = lastErr?.response?.data ? JSON.stringify(lastErr.response.data) : lastErr?.message;
    throw new Error(`YouTube video upload failed: ${detail}`);
  }

  /** Hỏi phiên resumable đã nhận được bao nhiêu byte. null = không xác định được. */
  private async queryUploadOffset(
    uploadUrl: string,
    fileSize: number,
    accessToken: string,
  ): Promise<number | null> {
    try {
      const res = await axios.put(uploadUrl, null, {
        headers: {
          'Content-Length': 0,
          'Content-Range': `bytes */${fileSize}`,
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 30000,
        // 308 Resume Incomplete là phản hồi bình thường của giao thức, không phải lỗi
        validateStatus: (s) => s === 308 || (s >= 200 && s < 300),
      });

      if (res.status !== 308) return fileSize; // đã nhận đủ
      const range = res.headers['range'];
      if (!range) return 0; // chưa nhận byte nào
      const end = parseInt(String(range).split('-').pop() || '', 10);
      return Number.isFinite(end) ? end + 1 : null;
    } catch (e: any) {
      this.logger.warn(`[YouTube] Hỏi mốc upload thất bại: ${e.message}`);
      return null;
    }
  }

  private get clientId(): string {
    return process.env.OAUTH_CLIENT_ID || process.env.YT_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
  }

  private get clientSecret(): string {
    return process.env.OAUTH_CLIENT_SECRET || process.env.YT_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
  }


  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; tokenExpiresAt: Date }> {
    const res = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 },
    );
    return {
      accessToken: res.data.access_token,
      tokenExpiresAt: new Date(Date.now() + res.data.expires_in * 1000),
    };
  }
}
