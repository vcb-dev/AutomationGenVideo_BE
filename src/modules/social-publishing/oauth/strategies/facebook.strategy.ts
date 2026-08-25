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
      // `instagram_manage_insights` là quyền DUY NHẤT đọc được lượt xem reels. Thiếu nó thì
      // mọi lời gọi /{media-id}/insights trả về "(#10) Application does not have permission
      // for this action" — đã đo trên token thật của 3 kênh: 15 quyền được cấp, không có
      // quyền này. Hệ quả: trang Tổng quan kênh nội bộ hiện Instagram với like/bình luận
      // nhưng lượt xem bằng 0 (1.446/1.470 reels trong kho có play_count = 0).
      //
      // instagram.strategy.ts (Flow 1) vốn đã xin quyền này; thiếu sót nằm ở đây — tài khoản
      // Instagram tạo ra từ luồng kết nối Facebook nên thừa hưởng đúng scope của luồng này.
      //
      // LƯU Ý: token đã cấp KHÔNG tự có thêm quyền. Phải kết nối lại tài khoản thì token mới
      // mang quyền mới.
      scope: 'public_profile,pages_show_list,pages_manage_posts,pages_read_engagement,business_management,instagram_basic,instagram_content_publish,instagram_manage_insights',
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
      timeout: 15000,
    });
    const shortToken = shortRes.data.access_token;

    // 2. Long-lived token (60 ngày)
    const longRes = await axios.get('https://graph.facebook.com/v21.0/oauth/access_token', {
      params: { grant_type: 'fb_exchange_token', client_id: process.env.FB_APP_ID, client_secret: process.env.FB_APP_SECRET, fb_exchange_token: shortToken },
      timeout: 15000,
    });
    const accessToken = longRes.data.access_token;
    const expiresIn = longRes.data.expires_in || 5184000; // 60 days default

    // 3. Profile
    const profileRes = await axios.get('https://graph.facebook.com/v21.0/me', {
      params: { access_token: accessToken, fields: 'id,name,picture.type(large)' },
      timeout: 15000,
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
