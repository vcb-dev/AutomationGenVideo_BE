import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { SocialPlatform } from '@prisma/client';

/** Build redirect URI: ưu tiên env cụ thể, fallback về PUBLIC_BASE_URL/API_BASE_URL */
function buildRedirectUri(envVar: string, platform: string): string {
  if (process.env[envVar]) return process.env[envVar]!;
  const base = (process.env.PUBLIC_BASE_URL || process.env.API_BASE_URL || 'http://localhost:3000/api')
    .replace(/\/api$/, '');
  return `${base}/api/social/oauth/${platform}/callback`;
}

@Injectable()
export class YoutubeOAuthStrategy {
  readonly platform = SocialPlatform.YOUTUBE;

  private get redirectUri() {
    return buildRedirectUri('YT_REDIRECT_URI', 'youtube');
  }

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.YT_CLIENT_ID!,
      redirect_uri: this.redirectUri,
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/userinfo.profile',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCode(code: string): Promise<{
    platformId: string; name: string; username: string; avatarUrl: string;
    accessToken: string; refreshToken: string; tokenExpiresAt: Date;
  }> {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      client_id: process.env.YT_CLIENT_ID!,
      client_secret: process.env.YT_CLIENT_SECRET!,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
      code,
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });

    const { access_token, refresh_token, expires_in = 3600 } = tokenRes.data;

    const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 15000,
    });
    const u = profileRes.data;

    // YouTube channel info
    const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'snippet', mine: true },
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 15000,
    });
    const channel = channelRes.data.items?.[0];

    return {
      platformId: channel?.id || u.id,
      name: channel?.snippet?.title || u.name,
      username: u.email,
      avatarUrl: channel?.snippet?.thumbnails?.default?.url || u.picture,
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
    };
  }

  async refreshToken(refreshToken: string): Promise<{ accessToken: string; tokenExpiresAt: Date }> {
    const res = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      client_id: process.env.YT_CLIENT_ID!,
      client_secret: process.env.YT_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });

    return {
      accessToken: res.data.access_token,
      tokenExpiresAt: new Date(Date.now() + res.data.expires_in * 1000),
    };
  }
}
