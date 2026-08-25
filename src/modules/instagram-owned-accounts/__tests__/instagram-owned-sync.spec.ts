import {
  extractHashtags,
  extractShortcode,
  isVideoMedia,
  resolveApiBase,
  resolveInstagramUserId,
  InstagramOwnedAccountsService,
  type FetchedInstagramMedia,
} from '../instagram-owned-accounts.service';

/**
 * Kênh Instagram nội bộ phải suy ra từ tài khoản đã kết nối ở trang đăng bài MXH.
 *
 * Đo được trên DB: 89 tài khoản Instagram đã kết nối OAuth, 44 profile trong kho scraper đã
 * có sẵn 2.213 reels — nhưng `is_owned` đều false, nên trang Tổng quan kênh nội bộ lọc sạch
 * Instagram và chỉ còn mỗi Facebook. Threads không dính vì có
 * ThreadsOwnedAccountsService đọc SocialAccount rồi bật `is_owned` giúp; Instagram thì chưa
 * có ai làm việc đó.
 */
describe('Đồng bộ kênh Instagram nội bộ từ tài khoản đã kết nối', () => {
  describe('chọn endpoint theo luồng kết nối', () => {
    // Token của luồng qua Facebook là PAGE token, gọi graph.instagram.com sẽ trả lỗi 190
    // chứ không báo gì rõ ràng — xem InstagramPublisher bên social-publishing.
    it('instagram_business dùng graph.facebook.com', () => {
      expect(resolveApiBase('instagram_business')).toContain('graph.facebook.com');
    });

    it('instagram_direct dùng graph.instagram.com', () => {
      expect(resolveApiBase('instagram_direct')).toContain('graph.instagram.com');
    });

    it('thiếu type thì mặc định về luồng qua Facebook — đó là luồng phổ biến', () => {
      expect(resolveApiBase(undefined)).toContain('graph.facebook.com');
      expect(resolveApiBase(null)).toContain('graph.facebook.com');
    });
  });

  describe('lấy Instagram User ID', () => {
    it('ưu tiên extra_data.igUserId', () => {
      expect(resolveInstagramUserId({ igUserId: '17841477977614557' }, 'khac')).toBe('17841477977614557');
    });

    it('không có thì rơi về platform_id', () => {
      expect(resolveInstagramUserId({ pageId: '800833209781066' }, 'du-phong')).toBe('du-phong');
      expect(resolveInstagramUserId(null, 'du-phong')).toBe('du-phong');
    });

    it('không có gì cả thì trả null để bỏ qua tài khoản đó', () => {
      expect(resolveInstagramUserId(null, '')).toBeNull();
    });
  });

  describe('lọc media', () => {
    const media = (over: Partial<FetchedInstagramMedia>): FetchedInstagramMedia => ({
      id: '1',
      timestamp: '2026-08-01T00:00:00+0000',
      ...over,
    });

    it.each(['REELS', 'VIDEO'])('nhận media_product_type=%s', (type) => {
      expect(isVideoMedia(media({ media_product_type: type }))).toBe(true);
    });

    it('nhận cả khi chỉ có media_type', () => {
      expect(isVideoMedia(media({ media_type: 'VIDEO' }))).toBe(true);
    });

    it.each(['IMAGE', 'CAROUSEL_ALBUM', 'STORY'])('bỏ qua %s — bảng reels không chứa ảnh', (type) => {
      expect(isVideoMedia(media({ media_type: type, media_product_type: type }))).toBe(false);
    });
  });

  describe('bóc shortcode từ permalink', () => {
    it.each([
      ['https://www.instagram.com/reel/ABC123/', 'ABC123'],
      ['https://www.instagram.com/p/XYZ789/', 'XYZ789'],
      ['https://www.instagram.com/tv/DEF456/?utm_source=ig', 'DEF456'],
    ])('%s → %s', (permalink, expected) => {
      expect(extractShortcode(permalink)).toBe(expected);
    });

    it('permalink lạ hoặc trống thì trả null', () => {
      expect(extractShortcode('https://example.com/abc')).toBeNull();
      expect(extractShortcode(undefined)).toBeNull();
    });
  });

  describe('bóc hashtag', () => {
    it('hạ chữ thường và bỏ dấu #', () => {
      expect(extractHashtags('Chơi hè #DuLich #dulich #Beach2026')).toEqual(['dulich', 'beach2026']);
    });

    it('nhận hashtag có dấu tiếng Việt', () => {
      expect(extractHashtags('#trangsức #bạc925')).toEqual(['trangsức', 'bạc925']);
    });

    it('caption trống thì mảng rỗng', () => {
      expect(extractHashtags('')).toEqual([]);
    });
  });

  describe('syncAllConnectedAccounts', () => {
    const buildService = (accounts: any[]) => {
      const prisma = {
        socialAccount: { findMany: jest.fn().mockResolvedValue(accounts) },
        scraperInstagramProfile: {
          findFirst: jest.fn().mockResolvedValue({ id: BigInt(1) }),
          update: jest.fn().mockResolvedValue({}),
          create: jest.fn().mockResolvedValue({ id: BigInt(1) }),
          updateMany: jest.fn().mockResolvedValue({}),
        },
        scraperInstagramReel: { upsert: jest.fn().mockResolvedValue({}) },
      };
      const crypto = { decrypt: jest.fn().mockReturnValue('token-that') };
      const service = new InstagramOwnedAccountsService(prisma as never, crypto as never);
      jest.spyOn(service, 'fetchUserProfile').mockResolvedValue({ id: 'ig1', username: 'kenh_cong_ty' });
      jest.spyOn(service, 'fetchUserMedia').mockResolvedValue([]);
      return { service, prisma, crypto };
    };

    const account = (over: Record<string, unknown> = {}) => ({
      id: 'sa-1',
      username: 'kenh_cong_ty',
      name: 'Kênh công ty',
      platform_id: 'ig1',
      access_token_enc: 'enc',
      extra_data: { type: 'instagram_business', igUserId: '17841477977614557' },
      ...over,
    });

    it('bật is_owned cho kênh lấy từ tài khoản đã kết nối', async () => {
      const { service, prisma } = buildService([account()]);

      const res = await service.syncAllConnectedAccounts();

      expect(res.accounts).toBe(1);
      expect(prisma.scraperInstagramProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ is_owned: true }) }),
      );
    });

    it('không ghi đè is_tracked / is_bookmarked — đó là lựa chọn của người dùng', async () => {
      const { service, prisma } = buildService([account()]);

      await service.syncAllConnectedAccounts();

      for (const call of prisma.scraperInstagramProfile.update.mock.calls) {
        expect(call[0].data).not.toHaveProperty('is_tracked');
        expect(call[0].data).not.toHaveProperty('is_bookmarked');
      }
    });

    it('một kênh nhiều người cùng kết nối chỉ đồng bộ MỘT lần', async () => {
      // Bảng social_accounts unique theo (user_id, platform, platform_id) nên cùng một kênh
      // xuất hiện nhiều dòng — đo được 89 dòng cho 48 kênh.
      const { service } = buildService([
        account({ id: 'sa-1' }),
        account({ id: 'sa-2' }),
        account({ id: 'sa-3' }),
      ]);

      const res = await service.syncAllConnectedAccounts();

      expect(res.accounts).toBe(1);
      expect(service.fetchUserProfile).toHaveBeenCalledTimes(1);
    });

    it('token hỏng thì đếm là lỗi và đi tiếp, không chết cả lượt chạy', async () => {
      const { service, crypto } = buildService([
        account({ id: 'sa-1', extra_data: { igUserId: 'ig-hong' } }),
        account({ id: 'sa-2', extra_data: { igUserId: 'ig-tot' } }),
      ]);
      crypto.decrypt.mockImplementationOnce(() => {
        throw new Error('bad key');
      });

      const res = await service.syncAllConnectedAccounts();

      expect(res.failed).toBe(1);
      expect(res.updatedProfiles).toBe(1);
    });

    it('tài khoản không có Instagram User ID thì bỏ qua', async () => {
      const { service } = buildService([account({ platform_id: '', extra_data: {} })]);

      const res = await service.syncAllConnectedAccounts();

      expect(res.accounts).toBe(0);
      expect(service.fetchUserProfile).not.toHaveBeenCalled();
    });

    it('Graph API không trả profile thì tính lỗi, không tạo kênh rỗng', async () => {
      const { service, prisma } = buildService([account()]);
      jest.spyOn(service, 'fetchUserProfile').mockResolvedValue(null);

      const res = await service.syncAllConnectedAccounts();

      expect(res.failed).toBe(1);
      expect(prisma.scraperInstagramProfile.create).not.toHaveBeenCalled();
    });
  });
});
