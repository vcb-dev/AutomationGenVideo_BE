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
export class FacebookOAuthStrategy {
  private readonly logger = new Logger(FacebookOAuthStrategy.name);
  readonly platform = SocialPlatform.FACEBOOK;

  private get redirectUri() { return buildRedirectUri('FB_REDIRECT_URI', 'facebook'); }

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.FB_APP_ID!,
      redirect_uri: this.redirectUri,
      scope: 'public_profile,pages_show_list,pages_manage_posts,pages_read_engagement,business_management,instagram_basic,instagram_content_publish',
      response_type: 'code',
      state,
    });
    return `https://www.facebook.com/dialog/oauth?${params}`;
  }

  async exchangeCode(code: string): Promise<{
    platformId: string; name: string; username: string; avatarUrl: string;
    accessToken: string; tokenExpiresAt: Date;
  }> {
    // 1. Short-lived token
    const shortRes = await axios.get('https://graph.facebook.com/v21.0/oauth/access_token', {
      params: { client_id: process.env.FB_APP_ID, client_secret: process.env.FB_APP_SECRET, redirect_uri: this.redirectUri, code },
    });
    const shortToken = shortRes.data.access_token;

    // 2. Long-lived token (60 ngày)
    const longRes = await axios.get('https://graph.facebook.com/v21.0/oauth/access_token', {
      params: { grant_type: 'fb_exchange_token', client_id: process.env.FB_APP_ID, client_secret: process.env.FB_APP_SECRET, fb_exchange_token: shortToken },
    });
    const accessToken = longRes.data.access_token;
    const expiresIn = longRes.data.expires_in || 5184000; // 60 days default

    // 3. Profile
    const profileRes = await axios.get('https://graph.facebook.com/v21.0/me', {
      params: { access_token: accessToken, fields: 'id,name,picture.type(large)' },
    });
    const p = profileRes.data;

    return {
      platformId: p.id,
      name: p.name,
      username: p.id,
      avatarUrl: p.picture?.data?.url,
      accessToken,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }
}
