import { Injectable, NotFoundException, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { isAdminRole, buildAccountVisibilityWhere } from '../../../common/utils/social-roles.util';
import { CryptoService } from '../crypto/crypto.service';
import { InstagramScraperService } from '../../instagram-scraper/instagram-scraper.service';
import { SocialPlatform } from '@prisma/client';
import axios from 'axios';

@Injectable()
export class AccountsService implements OnModuleDestroy {
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
    private readonly instagramScraper: InstagramScraperService,
  ) { }


  onModuleDestroy() {
    clearInterval(this.pagesCacheCleanupInterval);
  }

  /**
   * Danh sách tài khoản người gọi được nhìn thấy.
   *
   * ADMIN/MANAGER thấy toàn bộ, kèm chủ sở hữu để biết ai đã gắn tài khoản nào.
   * LEADER và MEMBER chỉ thấy tài khoản do chính mình liên kết.
   *
   * `is_shared` CỐ TÌNH không tham gia vào điều kiện nhìn: nó là cờ cho phép người khác
   * ĐĂNG BÀI lên tài khoản (xem findOne), không phải cờ hiển thị. Trộn hai khái niệm này
   * chính là thứ khiến 287/287 tài khoản của 3 người hiện ra với tất cả mọi người.
   */
  async findAll(userId: string, callerRoles: string[] = []) {
    const seesEverything = isAdminRole(callerRoles);

    const accounts = await this.prisma.socialAccount.findMany({
      where: buildAccountVisibilityWhere(userId, callerRoles),
      orderBy: { created_at: 'desc' },
      ...(seesEverything
        ? { include: { user: { select: { id: true, full_name: true, email: true, team: true } } } }
        : {}),
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

  async disconnect(id: string, userId: string, isAdmin = false) {
    // Admin gỡ được mọi tài khoản; người khác chỉ gỡ tài khoản mình sở hữu.
    let ownerId = userId;
    if (isAdmin) {
      const account = await this.prisma.socialAccount.findFirst({
        where: { id, is_active: true },
      });
      if (!account) throw new NotFoundException('Social account not found');
      ownerId = account.user_id;
    } else {
      await this.findOneOwned(id, userId);
    }

    // Tắt account chính
    await this.prisma.socialAccount.update({
      where: { id },
      data: { is_active: false },
    });

    // Tắt account con qua parent_id (accounts mới) — theo chủ sở hữu của account cha
    await this.prisma.socialAccount.updateMany({
      where: { parent_id: id, user_id: ownerId },
      data: { is_active: false },
    });

    // Tắt account con qua extra_data.parentAccountId (accounts cũ không có parent_id)
    // Dùng raw query vì Prisma không filter trực tiếp vào JSON field
    await this.prisma.$executeRaw`
      UPDATE social_accounts
      SET is_active = false
      WHERE user_id::text = ${ownerId}
        AND is_active = true
        AND extra_data->>'parentAccountId' = ${id}
    `;

    this.logger.log(`[disconnect] Đã gỡ account ${id} và tất cả account con${isAdmin && ownerId !== userId ? ` (admin ${userId} gỡ hộ owner ${ownerId})` : ''}`);
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
          fields: 'id,name,access_token,picture.type(large),instagram_business_account{id,name,username,profile_picture_url}',
          limit: 100,
        },
        timeout: 15000,
      });

      // Cache chỉ lưu metadata (không có access_token) để tránh token nằm trong RAM lâu
      const pages = (res.data.data || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        access_token: p.access_token, // trả về FE để FE gọi save-page; KHÔNG cache
        picture: p.picture?.data?.url || `https://graph.facebook.com/${p.id}/picture?type=large`,
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
        fields: 'id,name,access_token,picture.type(large),instagram_business_account{id,name,username,profile_picture_url}',
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
            pagePicture: p.picture?.data?.url || `https://graph.facebook.com/${p.id}/picture?type=large`,
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
      avatarUrl: opts.pagePicture || `https://graph.facebook.com/${opts.pageId}/picture?type=large`,

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
      // Check TRƯỚC khi saveAccount (upsert) — cần biết đây là lần lưu ĐẦU TIÊN hay
      // chỉ resync token, để không cào lại toàn bộ profile mỗi lần user bấm "Đồng bộ"
      // hoặc mỗi lần reconnect Facebook (autoSaveFacebookPages lặp qua TẤT CẢ page mỗi
      // lần chạy, kể cả page đã lưu từ trước — không guard ở đây thì user có nhiều IG
      // Business account sẽ bị bắn hàng loạt request cào đồng thời mỗi lần resync).
      const existingIgAccount = await this.prisma.socialAccount.findFirst({
        where: { user_id: userId, platform: SocialPlatform.INSTAGRAM, platform_id: opts.igId },
        select: { id: true },
      });

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

      // Tự động cào profile Instagram vừa kết nối qua Facebook Page — hiện luôn
      // trong internalChannels/instagram (is_owned=true) mà không cần user nhập tay
      // username. Chỉ cào cho account MỚI (fire-and-forget); account đã tồn tại thì
      // để cron periodicRefresh lo, tránh cào trùng hàng loạt mỗi lần resync.
      if (opts.igUsername && !existingIgAccount) {
        this.instagramScraper.scrapeProfile(opts.igUsername, true).catch((err: any) => {
          this.logger.warn(`[AutoScrape] Cào @${opts.igUsername} thất bại: ${err.message}`);
        });
      }
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

  /** Chạy mỗi ngày lúc 9h: cảnh báo token sắp/đã hết hạn (chỉ cảnh báo — KHÔNG tắt account) */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkExpiringTokens() {
    const now = new Date();
    const warnBefore = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // KHÔNG flip is_active=false khi token hết hạn. Trước đây làm vậy khiến account "tự biến mất"
    // khỏi trang Kênh (findAll chỉ trả is_active=true) mà user không được báo gì:
    // - Page con Facebook (page token KHÔNG hết hạn, vẫn đăng bài được) render lồng dưới card
    //   account cha ở FE — cha bị ẩn là toàn bộ page con biến mất theo dù trong DB vẫn active.
    // - TikTok/Zalo token chỉ sống ~24h, YouTube ~1h — bị tắt ngay lần cron kế tiếp dù
    //   refresh_token còn hạn dài (YouTube tự refresh lúc publish).
    // Token hết hạn giờ hiện "Đã hết hạn" trên banner (getExpiringAccounts) để user bấm kết nối
    // lại — saveAccount khi reconnect tự bật lại is_active.
    const expired = await this.prisma.socialAccount.count({
      where: { is_active: true, token_expires_at: { not: null, lt: now } },
    });
    if (expired > 0)
      this.logger.warn(`[TokenExpiry] ${expired} account có token đã hết hạn — chờ user kết nối lại (không tự ẩn)`);

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
    // YouTube tự refresh lúc publish nên không cảnh báo hết hạn
    const accounts = await this.prisma.socialAccount.findMany({
      where: {
        user_id: userId,
        is_active: true,
        platform: { not: SocialPlatform.YOUTUBE },
        token_expires_at: { not: null, lte: warnBefore },
      },
      select: { id: true, name: true, platform: true, avatar_url: true, token_expires_at: true },
      orderBy: { token_expires_at: 'asc' },
    });
    return accounts.map(a => ({
      ...a,
      days_until_expiry: Math.ceil((a.token_expires_at!.getTime() - now.getTime()) / 86400000),
    }));
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
    const isYouTube = rest.platform === SocialPlatform.YOUTUBE;
    return {
      ...rest,
      token_expires_soon: !isYouTube && daysLeft !== null && daysLeft <= 7,
      token_expires_in_days: isYouTube ? null : daysLeft,
    };
  }

}

