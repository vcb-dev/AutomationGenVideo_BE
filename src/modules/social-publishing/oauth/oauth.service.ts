import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import axios from 'axios';
import { AccountsService } from '../accounts/accounts.service';
import { FacebookOAuthStrategy } from './strategies/facebook.strategy';
import { InstagramOAuthStrategy } from './strategies/instagram.strategy';
import { TiktokOAuthStrategy } from './strategies/tiktok.strategy';
import { ThreadsOAuthStrategy } from './strategies/threads.strategy';
import { YoutubeOAuthStrategy } from './strategies/youtube.strategy';
import { ZaloOAuthStrategy } from './strategies/zalo.strategy';
import { SocialPlatform } from '@prisma/client';

const STATE_TTL_MS = 15 * 60 * 1000; // 15 phút

function getStateSecret(): string {
  return process.env.SOCIAL_TOKEN_SECRET || process.env.JWT_SECRET || 'vcb-social-default-key-32chars!!';
}

// State = base64url(payload) + '.' + hmac_sha256(payload)
// Ngăn forge state (CSRF) và replay tấn công
function encodeState(data: Record<string, any>): string {
  const payload = Buffer.from(JSON.stringify({ ...data, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', getStateSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function decodeState(state: string): Record<string, any> | null {
  try {
    const lastDot = state.lastIndexOf('.');
    if (lastDot === -1) return null;

    const payload = state.substring(0, lastDot);
    const sig = state.substring(lastDot + 1);

    const expectedSig = crypto.createHmac('sha256', getStateSecret()).update(payload).digest('hex');

    // Timing-safe so để tránh timing attack
    if (sig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) return null;

    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.iat || Date.now() - parsed.iat > STATE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly accounts: AccountsService,
    private readonly facebook: FacebookOAuthStrategy,
    private readonly instagram: InstagramOAuthStrategy,
    private readonly tiktok: TiktokOAuthStrategy,
    private readonly threads: ThreadsOAuthStrategy,
    private readonly youtube: YoutubeOAuthStrategy,
    private readonly zalo: ZaloOAuthStrategy,
  ) {}

  async getAuthUrl(platform: string, userId: string): Promise<{ url: string }> {
    let url: string;

    switch (platform) {
      case 'FACEBOOK': {
        const state = encodeState({ userId, platform });
        url = this.facebook.getAuthUrl(state);
        break;
      }
      case 'INSTAGRAM': {
        const state = encodeState({ userId, platform });
        url = this.instagram.getAuthUrl(state);
        break;
      }
      case 'TIKTOK': {
        // TikTok cần PKCE verifier → encode vào state
        const { codeVerifier } = this.tiktok.getAuthUrl('');
        const state = encodeState({ userId, platform, codeVerifier });
        // Rebuild URL với state mới (tiktok strategy đã tạo challenge từ verifier)
        const { url: finalUrl } = this.tiktok.getAuthUrlWithState(state, codeVerifier);
        url = finalUrl;
        break;
      }
      case 'THREADS': {
        const state = encodeState({ userId, platform });
        url = this.threads.getAuthUrl(state);
        break;
      }
      case 'YOUTUBE': {
        const state = encodeState({ userId, platform });
        url = this.youtube.getAuthUrl(state);
        break;
      }
      case 'ZALO': {
        // Zalo PKCE: encode verifier vào state
        const { url: authUrl, codeVerifier } = this.zalo.getAuthUrlWithVerifier();
        const state = encodeState({ userId, platform, codeVerifier });
        url = this.zalo.buildAuthUrl(state, codeVerifier);
        break;
      }
      default:
        throw new BadRequestException(`Platform không hỗ trợ: ${platform}`);
    }

    return { url };
  }

  async handleCallback(platform: string, code: string, state: string, _extra: any) {
    // Decode state → lấy userId và extra data (không cần lookup DB/memory)
    const decoded = decodeState(state);
    if (!decoded?.userId) {
      this.logger.error(`[OAuth] Invalid state for ${platform}: ${state?.substring(0, 50)}`);
      throw new BadRequestException('OAuth state không hợp lệ. Vui lòng thử lại.');
    }

    const { userId, codeVerifier } = decoded;
    let result: any;

    switch (platform) {
      case 'FACEBOOK':  result = await this.facebook.exchangeCode(code); break;
      case 'INSTAGRAM': result = await this.instagram.exchangeCode(code); break;
      case 'TIKTOK': {
        if (!codeVerifier) throw new BadRequestException('TikTok PKCE verifier thiếu trong state');
        result = await this.tiktok.exchangeCode(code, state, codeVerifier);
        break;
      }
      case 'THREADS': result = await this.threads.exchangeCode(code); break;
      case 'YOUTUBE': result = await this.youtube.exchangeCode(code); break;
      case 'ZALO': {
        if (!codeVerifier) throw new BadRequestException('Zalo PKCE verifier thiếu trong state');
        result = await this.zalo.exchangeCode(code, codeVerifier);
        break;
      }
      default:
        throw new BadRequestException(`Platform không hỗ trợ: ${platform}`);
    }

    const saved = await this.accounts.saveAccount(userId, {
      platform: platform as SocialPlatform,
      platformId: result.platformId,
      name: result.name,
      username: result.username,
      avatarUrl: result.avatarUrl,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenExpiresAt: result.tokenExpiresAt,
      extraData: result.extraData,
    });

    // Tự động đồng bộ Token cho các tài khoản con (Pages, Instagram liên kết)
    if (platform === 'FACEBOOK') {
      // Không await để không làm chậm response callback, chạy ngầm
      this.accounts.syncFacebookChildrenTokens(saved.id, userId).catch(() => {});
    }

    this.logger.log(`[OAuth] ✅ Đã kết nối ${platform} cho user ${userId} — ${result.name}`);
    return { success: true };
  }

  async connectViaToken(
    platform: string,
    userId: string,
    body: { access_token: string; refresh_token?: string; page_id?: string },
  ) {
    const validPlatforms = Object.values(SocialPlatform) as string[];
    if (!validPlatforms.includes(platform)) {
      throw new BadRequestException(`Platform không hợp lệ: ${platform}`);
    }

    let platformId = `manual_${Date.now()}`;
    let name = `${platform} Account`;
    let username = '';

    try {
      if (platform === 'FACEBOOK') {
        const r = await axios.get('https://graph.facebook.com/v21.0/me', {
          params: { access_token: body.access_token, fields: 'id,name' },
        });
        platformId = r.data.id; name = r.data.name; username = r.data.id;
      } else if (platform === 'THREADS') {
        const r = await axios.get('https://graph.threads.net/v1.0/me', {
          params: { access_token: body.access_token, fields: 'id,username,name' },
        });
        platformId = r.data.id; name = r.data.name || r.data.username; username = r.data.username;
      }
    } catch (e: any) {
      this.logger.warn(`[connectViaToken] profile fetch failed: ${e.message}`);
    }

    await this.accounts.saveAccount(userId, {
      platform: platform as SocialPlatform,
      platformId, name, username,
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      extraData: body.page_id ? { pageId: body.page_id } : undefined,
    });

    return { success: true, platform, name };
  }
}
