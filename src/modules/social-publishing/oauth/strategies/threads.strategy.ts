import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { SocialPlatform } from '@prisma/client';

function buildRedirectUri(envVar: string, platform: string): string {
  if (process.env[envVar]) return process.env[envVar]!;
  const base = (process.env.PUBLIC_BASE_URL || process.env.API_BASE_URL || 'http://localhost:3000/api')
    .replace(/\/api$/, '');
  return `${base}/api/social/oauth/${platform}/callback`;
}

@Injectable()
export class ThreadsOAuthStrategy {
  readonly platform = SocialPlatform.THREADS;
  private readonly logger = new Logger(ThreadsOAuthStrategy.name);

  private get redirectUri() { return buildRedirectUri('THREADS_REDIRECT_URI', 'threads'); }

  getAuthUrl(state: string): string {
    const appId = process.env.THREADS_APP_ID;
    if (!appId) throw new Error('THREADS_APP_ID chưa được cấu hình trong .env');
    const redirectUri = this.redirectUri;
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      scope: 'threads_basic,threads_content_publish',
      response_type: 'code',
      state,
    });
    return `https://www.threads.net/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string): Promise<{
    platformId: string; name: string; username: string; avatarUrl: string;
    accessToken: string; tokenExpiresAt: Date; extraData: Record<string, any>;
  }> {
    const appId = process.env.THREADS_APP_ID;
    const appSecret = process.env.THREADS_APP_SECRET;
    if (!appId || !appSecret) throw new Error('THREADS_APP_ID hoặc THREADS_APP_SECRET chưa được cấu hình trong .env');
    const redirectUri = this.redirectUri;

    const form = new URLSearchParams({
      client_id: appId, client_secret: appSecret,
      grant_type: 'authorization_code', redirect_uri: redirectUri, code,
    });
    try {
      const shortRes = await axios.post('https://graph.threads.net/oauth/access_token', form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const { access_token: shortToken } = shortRes.data;

      const longRes = await axios.get('https://graph.threads.net/access_token', {
        params: { grant_type: 'th_exchange_token', client_secret: appSecret, access_token: shortToken },
      });
      const accessToken = longRes.data.access_token;
      const expiresIn = longRes.data.expires_in || 5184000;

      const profileRes = await axios.get('https://graph.threads.net/v1.0/me', {
        params: { access_token: accessToken, fields: 'id,username,threads_profile_picture_url' },
      });
      const p = profileRes.data;

      return {
        platformId: String(p.id),
        name: p.username,
        username: p.username,
        avatarUrl: p.threads_profile_picture_url,
        accessToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        // platformId lưu vào extraData để publish service dùng khi dispatch
        extraData: { platformId: String(p.id) },
      };
    } catch (error: any) {
      throw new Error(`Threads OAuth thất bại: ${error.response?.data?.error_message || error.message}`);
    }
  }
}
