import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  // ────────────────────────────────────────────────
  // META (FACEBOOK / INSTAGRAM)
  // ────────────────────────────────────────────────

  /** Tạo URL xin quyền Facebook */
  getFacebookAuthUrl(): string {
    const appId = this.config.get<string>('FACEBOOK_APP_ID');
    const callbackUrl = encodeURIComponent(
      this.config.get<string>('FACEBOOK_CALLBACK_URL'),
    );
    const scopes = [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_metadata',
      'instagram_basic',
      'instagram_manage_insights',
      'ads_read',
      'business_management',
    ].join(',');

    return (
      `https://www.facebook.com/v19.0/dialog/oauth` +
      `?client_id=${appId}` +
      `&redirect_uri=${callbackUrl}` +
      `&scope=${scopes}` +
      `&response_type=code`
    );
  }

  /** Xử lý callback từ Facebook: đổi code → token → lấy danh sách pages → lưu DB */
  async handleFacebookCallback(code: string) {
    if (!code) throw new BadRequestException('Thiếu tham số code từ Facebook');

    const appId = this.config.get<string>('FACEBOOK_APP_ID');
    const appSecret = this.config.get<string>('FACEBOOK_APP_SECRET');
    const callbackUrl = this.config.get<string>('FACEBOOK_CALLBACK_URL');

    // 1. Đổi code lấy User Access Token
    const tokenRes = await axios.get(
      `https://graph.facebook.com/v19.0/oauth/access_token`,
      {
        params: {
          client_id: appId,
          client_secret: appSecret,
          redirect_uri: callbackUrl,
          code,
        },
      },
    );
    const userAccessToken: string = tokenRes.data.access_token;

    // 2. Lấy Long-Lived Token (60 ngày)
    const longTokenRes = await axios.get(
      `https://graph.facebook.com/v19.0/oauth/access_token`,
      {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: userAccessToken,
        },
      },
    );
    const longLivedToken: string = longTokenRes.data.access_token;

    // 3. Lấy danh sách Fanpages mà user quản lý
    const pagesRes = await axios.get(`https://graph.facebook.com/v19.0/me/accounts`, {
      params: { access_token: longLivedToken, fields: 'id,name,picture,access_token,instagram_business_account' },
    });
    const pages: any[] = pagesRes.data?.data ?? [];

    // 4. Lưu từng Fanpage vào BusinessChannelConnection
    const results: any[] = [];
    for (const page of pages) {
      // Lưu Facebook Page
      const fbRecord = await this.prisma.businessChannelConnection.upsert({
        where: { platform_id_platform: { platform_id: page.id, platform: 'Facebook' } },
        update: {
          channel_name: page.name,
          avatar_url: page.picture?.data?.url ?? null,
          sync_status: 'Đã kết nối',
          is_active: true,
          updated_at: new Date(),
        },
        create: {
          platform_id: page.id,
          channel_name: page.name,
          platform: 'Facebook',
          connection_type: 'Kênh nội dung',
          sync_status: 'Đã kết nối',
          avatar_url: page.picture?.data?.url ?? null,
          is_active: true,
        },
      });
      results.push(fbRecord);

      // Nếu page có gắn Instagram Business Account → lưu luôn Instagram
      if (page.instagram_business_account?.id) {
        const igId = page.instagram_business_account.id;
        const igRes = await axios.get(`https://graph.facebook.com/v19.0/${igId}`, {
          params: { fields: 'id,name,profile_picture_url', access_token: page.access_token },
        }).catch(() => null);

        if (igRes?.data) {
          const igRecord = await this.prisma.businessChannelConnection.upsert({
            where: { platform_id_platform: { platform_id: igId, platform: 'Instagram' } },
            update: {
              channel_name: igRes.data.name ?? `Instagram (${igId})`,
              avatar_url: igRes.data.profile_picture_url ?? null,
              sync_status: 'Đã kết nối',
              is_active: true,
              updated_at: new Date(),
            },
            create: {
              platform_id: igId,
              channel_name: igRes.data.name ?? `Instagram (${igId})`,
              platform: 'Instagram',
              connection_type: 'Kênh nội dung',
              sync_status: 'Đã kết nối',
              avatar_url: igRes.data.profile_picture_url ?? null,
              is_active: true,
            },
          });
          results.push(igRecord);
        }
      }
    }

    await this.saveTokenToAi(longLivedToken);

    this.logger.log(`✅ Facebook OAuth: Đã lưu ${results.length} kênh vào DB`);
    return { success: true, count: results.length, channels: results };
  }

  /**
   * Gửi User Access Token vừa cấp sang AI để lưu vào token store.
   *
   * Vì sao bắt buộc: quyền Facebook đóng cứng vào token lúc phát hành. App được duyệt thêm
   * quyền KHÔNG làm token cũ mạnh lên, và `fb_exchange_token` chỉ đổi hạn chứ không thêm quyền
   * (đo 16/08/2026: token vừa gia hạn vẫn thiếu `instagram_manage_insights`). Đường DUY NHẤT
   * để có quyền mới là qua màn hình đồng ý — tức chính luồng này. Trước đây token mới bị vứt
   * đi ngay sau khi gọi /me/accounts, nên cấp quyền xong hệ thống vẫn chạy bằng token cũ và
   * người cấp tưởng đã xong.
   *
   * AI giữ token store (.fb_token.json) nên BE gửi sang thay vì tự ghi file — giữ đúng ranh
   * giới sẵn có giữa hai repo.
   *
   * Hỏng thì chỉ log: kênh đã lưu vào DB xong rồi, ném lỗi ở đây là người dùng thấy màn hình
   * đỏ dù việc chính đã thành công, rồi bấm cấp quyền lại từ đầu — vô ích.
   */
  private async saveTokenToAi(longLivedToken: string): Promise<void> {
    const aiServiceUrl = this.config.get<string>('AI_SERVICE_URL');
    try {
      await axios.post(
        `${aiServiceUrl}/api/facebook/fetch/token-save/`,
        { access_token: longLivedToken },
        { timeout: 30_000 },
      );
      this.logger.log('✅ Đã lưu User Access Token mới vào token store của AI');
    } catch (err: any) {
      this.logger.error(
        `❌ Không lưu được token mới sang AI: ${err.message} — hệ thống vẫn chạy token cũ, ` +
          'quyền mới cấp sẽ KHÔNG có tác dụng cho tới khi lưu được',
      );
    }
  }

  // ────────────────────────────────────────────────
  // TIKTOK
  // ────────────────────────────────────────────────

  /** Tạo URL xin quyền TikTok */
  getTikTokAuthUrl(): string {
    const appId = this.config.get<string>('TIKTOK_APP_ID');
    const callbackUrl = encodeURIComponent(
      this.config.get<string>('TIKTOK_CALLBACK_URL'),
    );
    const scopes = ['user.info.basic', 'video.list', 'video.insights'].join(',');

    return (
      `https://www.tiktok.com/v2/auth/authorize/` +
      `?client_key=${appId}` +
      `&redirect_uri=${callbackUrl}` +
      `&scope=${scopes}` +
      `&response_type=code`
    );
  }

  /** Xử lý callback TikTok: đổi code → token → lấy user info → lưu DB */
  async handleTikTokCallback(code: string) {
    const appId = this.config.get<string>('TIKTOK_APP_ID');
    const appSecret = this.config.get<string>('TIKTOK_APP_SECRET');
    const callbackUrl = this.config.get<string>('TIKTOK_CALLBACK_URL');

    // 1. Đổi code lấy Access Token
    const tokenRes = await axios.post(
      `https://open.tiktokapis.com/v2/oauth/token/`,
      new URLSearchParams({
        client_key: appId,
        client_secret: appSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    if (tokenRes.data?.error) {
      throw new BadRequestException(`TikTok Token Error: ${tokenRes.data.error_description}`);
    }

    const { access_token, open_id } = tokenRes.data;

    // 2. Lấy thông tin user TikTok
    const userRes = await axios.get(`https://open.tiktokapis.com/v2/user/info/`, {
      headers: { Authorization: `Bearer ${access_token}` },
      params: { fields: 'open_id,union_id,avatar_url,display_name' },
    });

    const userData = userRes.data?.data?.user ?? {};

    // 3. Lưu kênh TikTok vào DB
    const record = await this.prisma.businessChannelConnection.upsert({
      where: { platform_id_platform: { platform_id: open_id, platform: 'TikTok' } },
      update: {
        channel_name: userData.display_name ?? `TikTok (${open_id})`,
        avatar_url: userData.avatar_url ?? null,
        sync_status: 'Đã kết nối',
        is_active: true,
        updated_at: new Date(),
      },
      create: {
        platform_id: open_id,
        channel_name: userData.display_name ?? `TikTok (${open_id})`,
        platform: 'TikTok',
        connection_type: 'Kênh nội dung',
        sync_status: 'Đã kết nối',
        avatar_url: userData.avatar_url ?? null,
        is_active: true,
      },
    });

    this.logger.log(`✅ TikTok OAuth: Đã lưu kênh ${record.channel_name}`);
    return { success: true, count: 1, channels: [record] };
  }
}
