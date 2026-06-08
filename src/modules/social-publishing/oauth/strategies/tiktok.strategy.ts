import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { SocialPlatform } from '@prisma/client';

function buildRedirectUri(envVar: string, platform: string): string {
  if (process.env[envVar]) return process.env[envVar]!;
  const base = (process.env.PUBLIC_BASE_URL || process.env.API_BASE_URL || 'http://localhost:3000/api')
    .replace(/\/api$/, '');
  return `${base}/api/social/oauth/${platform}/callback`;
}

@Injectable()
export class TiktokOAuthStrategy {
  readonly platform = SocialPlatform.TIKTOK;

  private get redirectUri() { return buildRedirectUri('TT_REDIRECT_URI', 'tiktok'); }

  /** Tạo codeVerifier + codeChallenge, trả về url với state tạm (sẽ được oauth.service thay bằng encoded state) */
  getAuthUrl(_state: string): { url: string; codeVerifier: string } {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const params = new URLSearchParams({
      client_key: process.env.TT_CLIENT_KEY!,
      redirect_uri: this.redirectUri,
      scope: 'user.info.basic,video.publish,video.upload',
      response_type: 'code',
      state: 'temp',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return { url: `https://www.tiktok.com/v2/auth/authorize/?${params}`, codeVerifier };
  }

  /** Build final URL với state đã encode userId + codeVerifier */
  getAuthUrlWithState(state: string, codeVerifier: string): { url: string } {
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const params = new URLSearchParams({
      client_key: process.env.TT_CLIENT_KEY!,
      redirect_uri: this.redirectUri,
      scope: 'user.info.basic,video.publish,video.upload',
      response_type: 'code',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return { url: `https://www.tiktok.com/v2/auth/authorize/?${params}` };
  }

  async exchangeCode(code: string, _state: string, codeVerifier: string): Promise<{
    platformId: string; name: string; username: string; avatarUrl: string;
    accessToken: string; refreshToken: string; tokenExpiresAt: Date;
  }> {
    const res = await axios.post(
      'https://open.tiktokapis.com/v2/oauth/token/',
      new URLSearchParams({
        client_key: process.env.TT_CLIENT_KEY!,
        client_secret: process.env.TT_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 },
    );

    const { access_token, refresh_token, expires_in, open_id } = res.data;
    if (!access_token) throw new Error(`TikTok token exchange failed: ${JSON.stringify(res.data)}`);

    const profileRes = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      params: { fields: 'open_id,union_id,avatar_url,display_name' },
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 15000,
    });
    const u = profileRes.data.data?.user || {};

    return {
      platformId: open_id || u.open_id,
      name: u.display_name || 'TikTok User',
      username: u.display_name || open_id,
      avatarUrl: u.avatar_url,
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiresAt: new Date(Date.now() + (expires_in || 86400) * 1000),
    };
  }
}
