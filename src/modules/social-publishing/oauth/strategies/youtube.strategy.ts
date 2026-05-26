import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { SocialPlatform } from '@prisma/client';

@Injectable()
export class YoutubeOAuthStrategy {
  readonly platform = SocialPlatform.YOUTUBE;

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.YT_CLIENT_ID!,
      redirect_uri: process.env.YT_REDIRECT_URI!,
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
      redirect_uri: process.env.YT_REDIRECT_URI!,
      grant_type: 'authorization_code',
      code,
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const { access_token, refresh_token, expires_in = 3600 } = tokenRes.data;

    const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const u = profileRes.data;

    // YouTube channel info
    const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'snippet', mine: true },
      headers: { Authorization: `Bearer ${access_token}` },
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
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    return {
      accessToken: res.data.access_token,
      tokenExpiresAt: new Date(Date.now() + res.data.expires_in * 1000),
    };
  }
}
