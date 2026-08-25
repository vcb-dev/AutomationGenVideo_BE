import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { SocialPlatform } from '@prisma/client';

/**
 * Instagram OAuth hỗ trợ 2 flow:
 *
 * Flow 1 — "via_facebook" (mặc định):
 *   → Dùng Facebook OAuth (facebook.com/dialog/oauth) với FB_APP_ID
 *   → Sau callback: /me/accounts → instagram_business_account
 *   → Phù hợp: tài khoản Instagram Business/Creator đã liên kết Facebook Page
 *
 * Flow 2 — "direct":
 *   → Dùng Instagram OAuth trực tiếp (api.instagram.com/oauth/authorize) với FB_APP_ID
 *   → Sau callback: /me trực tiếp trên graph.instagram.com
 *   → Phù hợp: tài khoản Instagram chưa liên kết Facebook Page (cần App có "Instagram" product)
 */
export type InstagramOAuthMode = 'via_facebook' | 'direct';

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

  /**
   * Tạo OAuth URL theo mode:
   * - mode = 'via_facebook' → facebook.com/dialog/oauth (default)
   * - mode = 'direct'       → api.instagram.com/oauth/authorize (Instagram Login)
   */
  getAuthUrl(state: string, mode: InstagramOAuthMode = 'via_facebook'): string {
    if (mode === 'direct') {
      // Flow 2: Instagram Direct Login (Instagram API with Instagram Login)
      // Dùng IG_APP_ID (Instagram-specific app ID từ Meta) — KHÔNG phải FB_APP_ID
      const params = new URLSearchParams({
        client_id: process.env.IG_APP_ID!,
        redirect_uri: this.redirectUri,
        // CHỈ xin đúng 2 quyền app thực sự dùng. 'instagram_business_manage_comments'
        // và '..._manage_messages' đã bị gỡ: app không gọi API comments/messages,
        // mà chúng vẫn hiện trên màn hình consent → Meta App Review coi là quyền
        // không khớp use case và từ chối cả submission.
        scope: [
          'instagram_business_basic',
          'instagram_business_content_publish',
          'instagram_business_manage_insights',
        ].join(','),
        response_type: 'code',
        state,
      });
      // Lưu ý: authorize endpoint của "Instagram API with Instagram Login" là
      // www.instagram.com — KHÔNG phải api.instagram.com (đó là endpoint của
      // Instagram Basic Display API đã bị Meta khai tử). Redirect URI được khai
      // trong Meta dashboard chỉ được product mới (www.instagram.com) nhận diện.
      return `https://www.instagram.com/oauth/authorize?${params}`;
    }

    // Flow 1: Via Facebook OAuth (default) — cho Business/Creator có FB Page
    const params = new URLSearchParams({
      client_id: process.env.FB_APP_ID!,
      redirect_uri: this.redirectUri,
      scope: [
        'instagram_basic',
        // Tên quyền chuẩn theo docs Meta là 'instagram_content_publish' (KHÔNG có
        // "ing" — 'instagram_content_publishing' không tồn tại, Meta sẽ strip scope
        // lạ → account kết nối xong thiếu quyền đăng bài).
        'instagram_content_publish',
        'instagram_manage_insights',
        'pages_show_list',
        'pages_read_engagement',
        'business_management',
      ].join(','),
      response_type: 'code',
      state,
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
  }

  /**
   * Exchange authorization code → account data
   * mode được đọc từ state (do oauth.service truyền vào)
   */
  async exchangeCode(
    code: string,
    mode: InstagramOAuthMode = 'via_facebook',
  ): Promise<{
    platformId: string;
    name: string;
    username: string;
    avatarUrl: string;
    accessToken: string;
    tokenExpiresAt: Date;
    extraData: Record<string, any>;
  }> {
    return mode === 'direct'
      ? this.exchangeCodeDirect(code)
      : this.exchangeCodeViaFacebook(code);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Flow 1: Via Facebook Page → Instagram Business Account
  // ─────────────────────────────────────────────────────────────────────────
  private async exchangeCodeViaFacebook(code: string) {
    const appId = process.env.FB_APP_ID!;
    const appSecret = process.env.FB_APP_SECRET!;

    // Bước 1: Exchange code → short-lived Facebook User Access Token
    const tokenRes = await axios.get('https://graph.facebook.com/v21.0/oauth/access_token', {
      params: { client_id: appId, client_secret: appSecret, redirect_uri: this.redirectUri, code },
      timeout: 15000,
    });
    const shortToken: string = tokenRes.data.access_token;

    // Bước 2: Đổi sang long-lived user token (60 ngày)
    const longRes = await axios.get('https://graph.facebook.com/v21.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      },
      timeout: 15000,
    });
    const userToken: string = longRes.data.access_token;
    const userTokenExpiry: number = longRes.data.expires_in || 5184000;

    // Bước 3: Lấy danh sách Facebook Pages kèm Instagram Business Account
    const pagesRes = await axios.get('https://graph.facebook.com/v21.0/me/accounts', {
      params: {
        access_token: userToken,
        fields: 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}',
        // Mặc định Graph API chỉ trả 25 page/trang — user quản lý nhiều page có thể
        // có page gắn IG nằm ngoài trang đầu → báo nhầm "chưa kết nối Instagram".
        limit: 100,
      },
      timeout: 15000,
    });

    const pages: any[] = pagesRes.data?.data || [];
    const pageWithIg = pages.find((p) => p.instagram_business_account);

    if (!pageWithIg) {
      throw new Error(
        'Tài khoản Facebook này chưa kết nối Instagram Business/Creator account. ' +
        'Hãy vào cài đặt Instagram → Chuyển sang tài khoản Chuyên nghiệp và liên kết với Facebook Page. ' +
        'Hoặc chọn "Kết nối Instagram trực tiếp" để đăng nhập bằng tài khoản Instagram.',
      );
    }

    const igAccount = pageWithIg.instagram_business_account;
    const pageToken: string = pageWithIg.access_token;

    // Lấy thêm thông tin profile nếu thiếu
    let username: string = igAccount.username;
    let name: string = igAccount.name;
    let avatarUrl: string = igAccount.profile_picture_url;

    if (!username || !avatarUrl) {
      const profileRes = await axios.get(`https://graph.facebook.com/v21.0/${igAccount.id}`, {
        params: { access_token: pageToken, fields: 'id,username,name,profile_picture_url' },
        timeout: 15000,
      });
      username = username || profileRes.data.username;
      name = name || profileRes.data.name;
      avatarUrl = avatarUrl || profileRes.data.profile_picture_url;
    }

    return {
      platformId: String(igAccount.id),
      name: name || username,
      username,
      avatarUrl: avatarUrl || '',
      accessToken: pageToken,
      tokenExpiresAt: new Date(Date.now() + userTokenExpiry * 1000),
      extraData: {
        igUserId: String(igAccount.id),
        fbPageId: pageWithIg.id,
        fbPageName: pageWithIg.name,
        userToken,
        type: 'instagram_via_facebook',
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Flow 2: Instagram Direct Login (Instagram API with Instagram Login)
  // Dùng cho tài khoản không liên kết Facebook Page
  // ─────────────────────────────────────────────────────────────────────────
  private async exchangeCodeDirect(code: string) {
    // Flow 2 dùng IG_APP_ID/IG_APP_SECRET (Instagram-specific credentials)
    const appId = process.env.IG_APP_ID!;
    const appSecret = process.env.IG_APP_SECRET!;

    // Bước 1: Exchange code → short-lived Instagram User Token
    const form = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri,
      code,
    });
    const shortRes = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      form.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 },
    );
    // Meta docs (Business Login for Instagram) mô tả response bọc trong mảng
    // "data" ({data:[{access_token,...}]}), nhưng thực tế quan sát được là dạng
    // phẳng — chấp nhận cả hai để không vỡ nếu Meta đổi format.
    const shortData = Array.isArray(shortRes.data?.data) ? shortRes.data.data[0] : shortRes.data;
    const shortToken: string = shortData?.access_token;
    if (!shortToken) {
      throw new Error(`Instagram token exchange không trả access_token: ${JSON.stringify(shortRes.data).slice(0, 300)}`);
    }

    // Bước 2: Đổi sang long-lived token (~60 ngày)
    const longRes = await axios.get('https://graph.instagram.com/access_token', {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: appSecret,
        access_token: shortToken,
      },
      timeout: 15000,
    });
    const accessToken: string = longRes.data.access_token;
    const expiresIn: number = longRes.data.expires_in || 5184000;

    // Bước 3: Lấy thông tin profile người dùng
    // Dùng "/me" thay vì "/{user_id}" — user_id trả về ở bước 1 (api.instagram.com)
    // là ID kiểu cũ, không khớp scoped-ID mà graph.instagram.com dùng để định danh
    // object. Gọi thẳng ID đó ngay sau khi đổi token báo lỗi giả
    // "Object with ID ... does not exist" (code 100, subcode 33) dù token hợp lệ.
    const profileRes = await axios.get('https://graph.instagram.com/v21.0/me', {
      params: { access_token: accessToken, fields: 'id,username,name,profile_picture_url' },
      timeout: 15000,
    });
    const p = profileRes.data;

    return {
      platformId: String(p.id),
      name: p.name || p.username,
      username: p.username,
      avatarUrl: p.profile_picture_url || '',
      accessToken,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      extraData: {
        igUserId: String(p.id),
        type: 'instagram_direct',
      },
    };
  }
}

