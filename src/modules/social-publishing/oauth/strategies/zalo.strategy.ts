import { Injectable, Logger } from '@nestjs/common';
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
export class ZaloOAuthStrategy {
  private readonly logger = new Logger(ZaloOAuthStrategy.name);
  readonly platform = SocialPlatform.ZALO;

  private get redirectUri() { return buildRedirectUri('ZALO_REDIRECT_URI', 'zalo'); }

  /** Tạo codeVerifier và codeChallenge, trả về để oauth.service encode vào state */
  getAuthUrlWithVerifier(): { url: string; codeVerifier: string } {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    // URL tạm — state sẽ được thay sau
    const url = this.buildAuthUrl('temp', codeChallenge);
    return { url, codeVerifier };
  }

  buildAuthUrl(state: string, codeVerifierOrChallenge: string): string {
    // codeVerifierOrChallenge: nếu là verifier thì hash lại, nếu đã là challenge thì dùng thẳng
    let challenge: string;
    try {
      // Thử hash (nếu là verifier)
      challenge = crypto.createHash('sha256').update(codeVerifierOrChallenge).digest('base64url');
    } catch {
      challenge = codeVerifierOrChallenge;
    }
    const params = new URLSearchParams({
      app_id: process.env.ZALO_APP_ID!,
      redirect_uri: this.redirectUri,
      code_challenge: challenge,
      state,
    });
    return `https://oauth.zaloapp.com/v4/oa/permission?${params}`;
  }

  /** Legacy: oauth.service cũ gọi cái này */
  getAuthUrl(state: string): string {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    return this.buildAuthUrl(state, codeVerifier);
  }

  /** Legacy getter — không cần nữa nhưng giữ để không break */
  getVerifier(_state: string): string | null {
    return null;
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<{
    platformId: string; name: string; username: string; avatarUrl: string;
    accessToken: string; refreshToken: string; tokenExpiresAt: Date;
  }> {
    // VCB-tool dùng secret_key header + form body (KHÔNG dùng app_secret trong body)
    const res = await axios.post(
      'https://oauth.zaloapp.com/v4/oa/access_token',
      new URLSearchParams({
        code,
        app_id: process.env.ZALO_APP_ID!,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'secret_key': process.env.ZALO_APP_SECRET!,
        },
        timeout: 15000,
      },
    );

    if (res.data?.error && res.data.error !== 0) {
      throw new Error(`Zalo token exchange failed: ${res.data.message || JSON.stringify(res.data)}`);
    }

    const { access_token, refresh_token, expires_in } = res.data;
    if (!access_token) throw new Error('Zalo: không nhận được access_token');

    let oaId = '', oaName = 'Zalo OA', oaAvatar = '';
    try {
      const oaRes = await axios.get('https://openapi.zalo.me/v2.0/oa/getoa', {
        headers: { access_token },
        timeout: 10000,
      });
      if (oaRes.data?.error === 0) {
        const oa = oaRes.data?.data || {};
        oaId = String(oa.oa_id || '');
        oaName = oa.name || 'Zalo OA';
        oaAvatar = oa.avatar || '';
      }
    } catch (e: any) {
      this.logger.warn(`[Zalo] Profile fetch failed: ${e.message}`);
    }

    return {
      platformId: oaId || process.env.ZALO_APP_ID!,
      name: oaName,
      username: oaId,
      avatarUrl: oaAvatar,
      accessToken: access_token,
      refreshToken: refresh_token || '',
      tokenExpiresAt: new Date(Date.now() + (expires_in || 86400) * 1000),
    };
  }
}
