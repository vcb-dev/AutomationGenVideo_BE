import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { SocialPlatform } from '@prisma/client';

function buildRedirectUri(envVar: string, platform: string): string {
  if (process.env[envVar]) return process.env[envVar]!;
  const base = (process.env.PUBLIC_BASE_URL || process.env.API_BASE_URL || 'http://localhost:3000/api')
    .replace(/\/api$/, '');
  return `${base}/api/social/oauth/${platform}/callback`;
}

@Injectable()
export class InstagramOAuthStrategy {
  readonly platform = SocialPlatform.INSTAGRAM;

  private get redirectUri() { return buildRedirectUri('IG_REDIRECT_URI', 'instagram'); }

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.IG_APP_ID || process.env.FB_APP_ID!,
      redirect_uri: this.redirectUri,
      scope: 'instagram_business_basic,instagram_content_publish',
      response_type: 'code',
      state,
    });
    return `https://api.instagram.com/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string): Promise<{
    platformId: string; name: string; username: string; avatarUrl: string;
    accessToken: string; tokenExpiresAt: Date; extraData: Record<string, any>;
  }> {
    const appId = process.env.IG_APP_ID || process.env.FB_APP_ID!;
    const appSecret = process.env.IG_APP_SECRET || process.env.FB_APP_SECRET!;

    const form = new URLSearchParams();
    form.append('client_id', appId);
    form.append('client_secret', appSecret);
    form.append('grant_type', 'authorization_code');
    form.append('redirect_uri', this.redirectUri);
    form.append('code', code);

    const shortRes = await axios.post('https://api.instagram.com/oauth/access_token', form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    const { access_token: shortToken, user_id } = shortRes.data;

    // Long-lived token
    const longRes = await axios.get('https://graph.instagram.com/access_token', {
      params: { grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: shortToken },
      timeout: 15000,
    });
    const accessToken = longRes.data.access_token;
    const expiresIn = longRes.data.expires_in || 5184000;

    const profileRes = await axios.get(`https://graph.instagram.com/v21.0/${user_id}`, {
      params: { access_token: accessToken, fields: 'id,username,name,profile_picture_url' },
      timeout: 15000,
    });
    const p = profileRes.data;

    return {
      platformId: String(user_id),
      name: p.name || p.username,
      username: p.username,
      avatarUrl: p.profile_picture_url,
      accessToken,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      // igUserId lưu vào extraData để publish service dùng
      extraData: { igUserId: String(user_id), type: 'instagram_direct' },
    };
  }
}
