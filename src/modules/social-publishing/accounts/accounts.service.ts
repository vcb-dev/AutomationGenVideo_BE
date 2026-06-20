import { Injectable, NotFoundException, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { SocialPlatform } from '@prisma/client';
import axios from 'axios';

@Injectable()
export class AccountsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountsService.name);
  private readonly pagesCache = new Map<string, { data: any[]; expiresAt: number }>();
  private readonly pagesCacheCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, val] of this.pagesCache.entries()) {
      if (val.expiresAt <= now) this.pagesCache.delete(key);
    }
  }, 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async onModuleInit() {
    try {
      await this.prisma.$executeRaw`UPDATE social_accounts SET is_shared = true WHERE is_active = true AND is_shared = false`;
      this.logger.log('[onModuleInit] Đã cập nhật is_shared = true cho tất cả accounts cũ');
    } catch (err: any) {
      this.logger.warn(`[onModuleInit] Bỏ qua cập nhật is_shared: ${err.message}`);
    }
  }

  onModuleDestroy() {
    clearInterval(this.pagesCacheCleanupInterval);
  }

  async findAll(userId: string) {
    const accounts = await this.prisma.socialAccount.findMany({
      where: {
        is_active: true,
        OR: [
          { user_id: userId },
          { is_shared: true } as any,
        ],
      },
      orderBy: { created_at: 'desc' },
    });
    return accounts.map((a) => this.sanitize(a));
  }

  /** Tìm account — cho phép truy cập shared accounts (dùng trong publish flow) */
  async findOne(id: string, userId: string) {
    const account = await this.prisma.socialAccount.findFirst({
      where: {
        id,
        is_active: true,
        OR: [
          { user_id: userId },
          { is_shared: true } as any,
        ],
      },
    });
    if (!account) throw new NotFoundException('Social account not found');
    return account;
  }

  /** Tìm account — chỉ chủ sở hữu (dùng cho disconnect, sync, save-page) */
  private async findOneOwned(id: string, userId: string) {
    const account = await this.prisma.socialAccount.findFirst({
      where: { id, user_id: userId, is_active: true },
    });
    if (!account) throw new NotFoundException('Social account not found or you are not the owner');
    return account;
  }

  async saveAccount(userId: string, data: {
    platform: SocialPlatform;
    platformId: string;
    name: string;
    username?: string;
    avatarUrl?: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
    parentId?: string;
    extraData?: Record<string, any>;
    isShared?: boolean;
  }) {
    const existing = await this.prisma.socialAccount.findFirst({
      where: { user_id: userId, platform: data.platform, platform_id: data.platformId },
    });

    const payload: any = {
      name: data.name,
      username: data.username,
      avatar_url: data.avatarUrl,
      access_token_enc: this.crypto.encrypt(data.accessToken),
      refresh_token_enc: data.refreshToken ? this.crypto.encrypt(data.refreshToken) : null,
      token_expires_at: data.tokenExpiresAt,
      parent_id: data.parentId || null,
      extra_data: data.extraData || {},
      is_active: true,
      // Chủ ý: account mặc định chia sẻ cho toàn hệ thống (is_shared = true).
      // Re-save (OAuth reconnect / auto-save token) cũng bật lại true là hành vi mong muốn.
      is_shared: data.isShared ?? true,
      updated_at: new Date(),
    };

    if (existing) {
      return this.prisma.socialAccount.update({ where: { id: existing.id }, data: payload });
    }

    return this.prisma.socialAccount.create({
      data: {
        user_id: userId,
        platform: data.platform,
        platform_id: data.platformId,
        ...payload,
      },
    });
  }

  async disconnect(id: string, userId: string) {
    await this.findOneOwned(id, userId);

    // Tắt account chính
    await this.prisma.socialAccount.update({
      where: { id },
      data: { is_active: false },
    });

    // Tắt account con qua parent_id (accounts mới)
    await this.prisma.socialAccount.updateMany({
      where: { parent_id: id, user_id: userId },
      data: { is_active: false },
    });

    // Tắt account con qua extra_data.parentAccountId (accounts cũ không có parent_id)
    // Dùng raw query vì Prisma không filter trực tiếp vào JSON field
    await this.prisma.$executeRaw`
      UPDATE social_accounts
      SET is_active = false
      WHERE user_id::text = ${userId}
        AND is_active = true
        AND extra_data->>'parentAccountId' = ${id}
    `;

    this.logger.log(`[disconnect] Đã gỡ account ${id} và tất cả account con`);
    return { success: true };
  }

  async getDecryptedToken(id: string, userId: string): Promise<string> {
    const account = await this.findOneOwned(id, userId);
    return this.crypto.decrypt(account.access_token_enc);
  }

  /** Lấy danh sách Facebook Pages + Instagram Business Account liên kết (không có token — dùng cho client) */
  async getFacebookPages(accountId: string, userId: string, forceRefresh = false) {
    const cacheKey = `pages:${accountId}`;
    const cached = this.pagesCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const account = await this.findOneOwned(accountId, userId);
    const token = this.crypto.decrypt(account.access_token_enc);

    try {
      const res = await axios.get('https://graph.facebook.com/v21.0/me/accounts', {
        params: {
          access_token: token,
          fields: 'id,name,access_token,picture,instagram_business_account{id,name,username,profile_picture_url}',
          limit: 100,
        },
        timeout: 15000,
      });

      // Cache chỉ lưu metadata (không có access_token) để tránh token nằm trong RAM lâu
      const pages = (res.data.data || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        access_token: p.access_token, // trả về FE để FE gọi save-page; KHÔNG cache
        picture: p.picture?.data?.url,
        instagram: p.instagram_business_account
          ? {
              id: p.instagram_business_account.id,
              name: p.instagram_business_account.name,
              username: p.instagram_business_account.username,
              profile_picture_url: p.instagram_business_account.profile_picture_url,
            }
          : null,
      }));

      // Lưu cache không kèm access_token
      const safePages = pages.map(({ access_token: _t, ...rest }) => rest);
      this.pagesCache.set(cacheKey, { data: safePages, expiresAt: Date.now() + 5 * 60 * 1000 });
      return pages; // trả về đầy đủ (có token) cho lần gọi này
    } catch (err: any) {
      this.logger.error(`getFacebookPages error: ${err.response?.data?.error?.message || err.message}`);
      throw new Error('Không lấy được danh sách Pages từ Facebook');
    }
  }

  /** Fetch pages trực tiếp từ API (không qua cache) — dùng nội bộ cho sync token và auto-save */
  private async fetchFacebookPagesWithTokens(accountId: string, userId: string) {
    const account = await this.findOneOwned(accountId, userId);
    const token = this.crypto.decrypt(account.access_token_enc);
    const res = await axios.get('https://graph.facebook.com/v21.0/me/accounts', {
      params: {
        access_token: token,
        fields: 'id,name,access_token,picture,instagram_business_account{id,name,username,profile_picture_url}',
        limit: 100,
      },
      timeout: 15000,
    });
    return (res.data.data || []) as Array<{
      id: string;
      name: string;
      access_token: string;
      picture?: { data?: { url?: string } };
      instagram_business_account?: { id: string; name?: string; username?: string; profile_picture_url?: string };
    }>;
  }

  /** Tự động lưu tất cả Facebook Pages (+ Instagram liên kết) sau khi OAuth thành công */
  async autoSaveFacebookPages(accountId: string, userId: string): Promise<void> {
    this.logger.log(`[AutoSave] Bắt đầu tự động lưu Pages cho account ${accountId}`);
    try {
      const pages = await this.fetchFacebookPagesWithTokens(accountId, userId);
      let savedCount = 0;
      for (const p of pages) {
        try {
          await this.saveFacebookPageAccount(userId, {
            parentAccountId: accountId,
            pageId: p.id,
            pageName: p.name,
            pageToken: p.access_token,
            pagePicture: p.picture?.data?.url,
            igId: p.instagram_business_account?.id,
            igName: p.instagram_business_account?.name,
            igUsername: p.instagram_business_account?.username,
            igPicture: p.instagram_business_account?.profile_picture_url,
          });
          savedCount++;
        } catch (e: any) {
          // Bỏ qua unique constraint (page đã tồn tại); log các lỗi khác để debug
          if (!e?.message?.includes('Unique constraint') && !e?.message?.includes('unique')) {
            this.logger.warn(`[AutoSave] Lỗi lưu page ${p.id}: ${e.message}`);
          }
        }
      }
      this.logger.log(`[AutoSave] ✅ Đã lưu ${savedCount}/${pages.length} Pages cho account ${accountId}`);
    } catch (err: any) {
      this.logger.warn(`[AutoSave] Thất bại: ${err.message}`);
    }
  }

  /** Lưu một Facebook Page thành SocialAccount riêng (để đăng bài trực tiếp vào Page) */
  async saveFacebookPageAccount(userId: string, opts: {
    parentAccountId: string;
    pageId: string;
    pageName: string;
    pageToken: string;
    pagePicture?: string;
    igId?: string;
    igName?: string;
    igUsername?: string;
    igPicture?: string;
  }) {
    // Validate parent account tồn tại và user là owner
    await this.findOneOwned(opts.parentAccountId, userId);

    // Lưu Page
    const pageAccount = await this.saveAccount(userId, {
      platform: SocialPlatform.FACEBOOK,
      platformId: `page_${opts.pageId}`,
      name: opts.pageName,
      username: opts.pageId,
      avatarUrl: opts.pagePicture,
      accessToken: opts.pageToken,
      parentId: opts.parentAccountId,
      extraData: {
        type: 'page',
        pageId: opts.pageId,
        parentAccountId: opts.parentAccountId,
        // pageToken KHÔNG lưu vào extra_data — đã mã hoá trong access_token_enc
      },
    });

    // Nếu có Instagram Business Account liên kết → lưu luôn
    if (opts.igId) {
      await this.saveAccount(userId, {
        platform: SocialPlatform.INSTAGRAM,
        platformId: opts.igId,
        name: opts.igName || opts.igUsername || 'Instagram',
        username: opts.igUsername,
        avatarUrl: opts.igPicture,
        accessToken: opts.pageToken, // Instagram dùng page token để publish
        parentId: opts.parentAccountId,
        extraData: {
          type: 'instagram_business',
          igUserId: opts.igId,
          pageId: opts.pageId,
          parentAccountId: opts.parentAccountId,
          // pageToken KHÔNG lưu vào extra_data — đã mã hoá trong access_token_enc
        },
      });
    }

    return { success: true, pageAccount: this.sanitize(pageAccount) };
  }

  /**
   * Tự động cập nhật Page Token cho các Page/Instagram con khi User Token (Parent) thay đổi.
   * Giúp user không phải kết nối lại thủ công từng Page/Insta.
   */
  async syncFacebookChildrenTokens(parentId: string, userId: string) {
    this.logger.log(`[Sync] Đang tự động cập nhật Token cho các tài khoản con của: ${parentId}`);
    try {
      const pages = await this.fetchFacebookPagesWithTokens(parentId, userId);
      
      for (const p of pages) {
        const encryptedToken = this.crypto.encrypt(p.access_token);

        // Cập nhật Token cho Page
        // Không lọc theo parent_id vì account cũ có thể chỉ có extra_data.parentAccountId
        const fbAccs = await this.prisma.socialAccount.findMany({
          where: { user_id: userId, platform: SocialPlatform.FACEBOOK, platform_id: `page_${p.id}` }
        });
        for (const acc of fbAccs) {
          // Xóa pageToken khỏi extra_data — token chỉ lưu trong access_token_enc
          const { pageToken: _pt, ...safeExtra } = (acc.extra_data as any) || {};
          await this.prisma.socialAccount.update({
            where: { id: acc.id },
            data: { access_token_enc: encryptedToken, extra_data: safeExtra, updated_at: new Date() }
          });
          this.logger.log(`[Sync] -> Đã cập nhật Token cho Page: ${acc.name}`);
        }

        // Cập nhật Token cho Instagram liên kết (nếu có)
        if (p.instagram_business_account) {
          // Không lọc theo parent_id vì account cũ có thể chỉ có extra_data.parentAccountId
          const igAccs = await this.prisma.socialAccount.findMany({
            where: { user_id: userId, platform: SocialPlatform.INSTAGRAM, platform_id: p.instagram_business_account.id }
          });
          for (const acc of igAccs) {
            const { pageToken: _pt, ...safeExtra } = (acc.extra_data as any) || {};
            await this.prisma.socialAccount.update({
              where: { id: acc.id },
              data: { access_token_enc: encryptedToken, extra_data: safeExtra, updated_at: new Date() }
            });
            this.logger.log(`[Sync] -> Đã cập nhật Token cho Instagram: ${acc.name}`);
          }
        }
      }
      this.logger.log(`[Sync] ✅ Đã đồng bộ Token cho ${pages.length} Pages/Instagram liên kết`);
    } catch (err: any) {
      this.logger.warn(`[Sync] Thất bại: ${err.message}`);
    }
  }

  /** Chạy mỗi ngày lúc 9h: cảnh báo token sắp hết hạn, vô hiệu hoá token đã hết hạn */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkExpiringTokens() {
    const now = new Date();
    const warnBefore = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const expired = await this.prisma.socialAccount.updateMany({
      where: { is_active: true, token_expires_at: { not: null, lt: now } },
      data: { is_active: false, updated_at: now },
    });
    if (expired.count > 0)
      this.logger.warn(`[TokenExpiry] Đã vô hiệu hoá ${expired.count} account hết hạn token`);

    const expiring = await this.prisma.socialAccount.findMany({
      where: { is_active: true, token_expires_at: { not: null, gte: now, lte: warnBefore } },
      select: { id: true, name: true, platform: true, token_expires_at: true, user_id: true },
    });

    for (const acc of expiring) {
      const daysLeft = Math.ceil((acc.token_expires_at!.getTime() - now.getTime()) / 86400000);
      this.logger.warn(`[TokenExpiry] ⚠️ ${acc.platform} "${acc.name}" hết hạn trong ${daysLeft} ngày (user: ${acc.user_id})`);
    }
    this.logger.log(`[TokenExpiry] Kiểm tra xong — ${expiring.length} account sắp hết hạn`);
  }

  async getExpiringAccounts(userId: string) {
    const now = new Date();
    const warnBefore = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const accounts = await this.prisma.socialAccount.findMany({
      where: { user_id: userId, is_active: true, token_expires_at: { not: null, gte: now, lte: warnBefore } },
      select: { id: true, name: true, platform: true, avatar_url: true, token_expires_at: true },
      orderBy: { token_expires_at: 'asc' },
    });
    return accounts.map(a => ({
      ...a,
      days_until_expiry: Math.ceil((a.token_expires_at!.getTime() - now.getTime()) / 86400000),
    }));
  }

  /**
   * Xác thực token Instagram có hiệu lực không
   * Sử dụng cho cả instagram_business (token của page) và instagram_direct (token của user)
   */
  async validateInstagramToken(token: string): Promise<{ userId: string; username?: string }> {
    try {
      // Thử lấy thông tin user từ Instagram API
      const res = await axios.get('https://graph.instagram.com/v21.0/me', {
        params: { fields: 'id,username', access_token: token },
        timeout: 10000,
      });
      return { userId: res.data.id, username: res.data.username };
    } catch (err: any) {
      const detail = err.response?.data?.error?.message || err.message;
      this.logger.error(`validateInstagramToken failed: ${detail}`);
      throw new Error(`Token Instagram không hợp lệ: ${detail}`);
    }
  }

  /**
   * Thêm tài khoản Instagram thủ công (không liên kết qua Facebook)
   * Loại: instagram_direct
   */
  async addManualInstagramAccount(userId: string, data: {
    name: string;
    username: string;
    access_token: string;
    parent_id?: string;
    avatar_url?: string;
  }): Promise<any> {
    this.logger.log(`[ManualIG] Thêm tài khoản Instagram thủ công: ${data.username}`);

    // Xác thực token
    const tokenInfo = await this.validateInstagramToken(data.access_token);

    // Nếu có parent_id, kiểm tra parent account tồn tại và user là owner
    if (data.parent_id) {
      await this.findOneOwned(data.parent_id, userId);
    }

    // Lưu tài khoản Instagram
    const account = await this.saveAccount(userId, {
      platform: SocialPlatform.INSTAGRAM,
      platformId: tokenInfo.userId,
      name: data.name,
      username: data.username,
      avatarUrl: data.avatar_url,
      accessToken: data.access_token,
      parentId: data.parent_id || null,
      extraData: {
        type: 'instagram_direct', // Loại: direct, không qua Facebook API
        igUserId: tokenInfo.userId,
        isManual: true, // Đánh dấu là thêm thủ công
        addedAt: new Date().toISOString(),
      },
    });

    this.logger.log(`[ManualIG] ✅ Đã thêm tài khoản Instagram: ${account.name} (${account.username})`);
    return { success: true, account: this.sanitize(account) };
  }

  /**
   * Lấy danh sách tài khoản Instagram thủ công (instagram_direct) của user
   */
  async getManualInstagramAccounts(userId: string): Promise<any[]> {
    const accounts = await this.prisma.socialAccount.findMany({
      where: {
        user_id: userId,
        platform: SocialPlatform.INSTAGRAM,
        is_active: true,
        extra_data: {
          path: ['type'],
          equals: 'instagram_direct',
        },
      },
      orderBy: { created_at: 'desc' },
    });
    return accounts.map(a => this.sanitize(a));
  }

  /**
   * Bật/tắt chia sẻ account cho toàn bộ hệ thống.
   * Khi is_shared = true → mọi user đều thấy và dùng được account này để publish.
   * Chỉ chủ sở hữu (owner) mới được thay đổi.
   */
  async setShared(id: string, userId: string, isShared: boolean): Promise<{ success: boolean; is_shared: boolean }> {
    await this.findOneOwned(id, userId);

    await this.prisma.socialAccount.update({
      where: { id },
      data: { is_shared: isShared } as any,
    });

    // Cập nhật luôn các account con (via parent_id)
    await this.prisma.socialAccount.updateMany({
      where: { parent_id: id },
      data: { is_shared: isShared } as any,
    });

    // Cập nhật account con cũ (via extra_data.parentAccountId)
    await this.prisma.$executeRaw`
      UPDATE social_accounts
      SET is_shared = ${isShared}
      WHERE extra_data->>'parentAccountId' = ${id}
    `;

    this.logger.log(`[setShared] Account ${id} is_shared = ${isShared} (bao gồm tất cả account con)`);
    return { success: true, is_shared: isShared };
  }

  private sanitize(account: any) {
    const { access_token_enc, refresh_token_enc, ...rest } = account;
    const now = Date.now();
    const expiresAt = rest.token_expires_at ? new Date(rest.token_expires_at).getTime() : null;
    const daysLeft = expiresAt ? Math.ceil((expiresAt - now) / 86400000) : null;
    return {
      ...rest,
      token_expires_soon: daysLeft !== null && daysLeft <= 7,
      token_expires_in_days: daysLeft,
    };
  }
}

