import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class YoutubePublisher {
  private readonly logger = new Logger(YoutubePublisher.name);

  async publish(token: string, opts: {
    title: string; description?: string; privacy?: string; mediaUrls: string[];
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
        title: (opts.title || 'Video').substring(0, 100),
        description: opts.description || '',
        tags: [],
      },
      status: { privacyStatus },
    };

    // HEAD request để lấy file size
    const headRes = await axios.head(videoUrl).catch(() => null);
    const rawContentLength = headRes?.headers?.['content-length'];
    const fileSize = rawContentLength ? parseInt(rawContentLength, 10) : 0;

    // Initiate resumable upload session
    const initRes = await axios.post(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      metadata,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
          ...(fileSize > 0 && { 'X-Upload-Content-Length': fileSize }),
        },
      },
    );
    const uploadUrl = initRes.headers.location;
    if (!uploadUrl) throw new Error('YouTube: không nhận được upload URL');

    // Stream video trực tiếp vào upload — không load toàn bộ file vào RAM
    const videoStream = await axios.get(videoUrl, { responseType: 'stream', timeout: 300000 });

    let uploadRes: any;
    try {
      uploadRes = await axios.put(uploadUrl, videoStream.data, {
        headers: {
          'Content-Type': 'video/mp4',
          ...(fileSize > 0 && { 'Content-Length': fileSize }),
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 600000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
    } catch (err) {
      try { videoStream?.data?.destroy(); } catch {}
      throw err;
    }

    const videoId = uploadRes.data.id;
    if (!videoId) throw new Error('YouTube: upload thành công nhưng không nhận được video ID');

    return { videoId, url: `https://youtube.com/watch?v=${videoId}` };
  }

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; tokenExpiresAt: Date }> {
    const res = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        client_id: process.env.YT_CLIENT_ID!,
        client_secret: process.env.YT_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    return {
      accessToken: res.data.access_token,
      tokenExpiresAt: new Date(Date.now() + res.data.expires_in * 1000),
    };
  }
}
