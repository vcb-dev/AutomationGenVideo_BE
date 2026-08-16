import { Logger } from '@nestjs/common';
import { InstagramOwnedAccountsService } from '../instagram-owned-accounts.service';

/**
 * Đồng bộ Instagram nội bộ qua Graph API — miễn phí, thay đường TikHub tính tiền mỗi lượt gọi.
 *
 * Tài khoản Instagram Business nối với Facebook Page thì đọc được bằng CHÍNH page token đang
 * dùng cho Facebook. Đo thật 16/08/2026: 14/25 fanpage có instagram_business_account, và page
 * token mới đẻ từ /me/accounts đọc `/{ig-id}/media` trả HTTP 200.
 *
 * Ghi thẳng vào ScraperInstagramProfile/ScraperInstagramReel — hai bảng mà trang "Kênh nội bộ"
 * và trang Tổng quan đang đọc — nên không cần bảng mới, không cần migration, FE không phải sửa.
 *
 * Hai thứ file này khoá lại, vì hỏng cái nào cũng âm thầm:
 *
 *   1. view_count = null KHÔNG được ghi thành 0. Lượt xem Instagram đòi quyền
 *      instagram_manage_insights mà token hiện tại chưa có, nên null xảy ra THƯỜNG XUYÊN chứ
 *      không phải hiếm. Ghi 0 đè lên số cũ chính là sự cố 27/07–09/08/2026 bên Facebook —
 *      13 ngày dashboard vẽ đường tụt về 0 mà trông như thật.
 *
 *   2. Page không nối Instagram (11/25) phải bỏ qua êm, không được tính là lỗi và không được
 *      làm đứt vòng lặp của các page phía sau.
 */
describe('InstagramOwnedAccountsService — đồng bộ Instagram nội bộ', () => {
  let prisma: any;
  let aiClient: { fetchOwnedAccount: jest.Mock; fetchMedia: jest.Mock };
  let service: InstagramOwnedAccountsService;

  const PAGES = [
    { id: 1n, page_id: 'p1', name: 'Page có IG', page_access_token: 'tok1' },
    { id: 2n, page_id: 'p2', name: 'Page không IG', page_access_token: 'tok2' },
  ];

  const ACCOUNT = {
    instagram_id: '17841400000000000',
    username: 'huyk_xuongchetac',
    full_name: 'HuyK Xưởng Chế Tác',
    url: 'https://www.instagram.com/huyk_xuongchetac/',
    avatar_url: 'https://cdn/a.jpg',
    biography: '',
    external_url: '',
    followers_count: 5812,
    posts_count: 3493,
    page_id: 'p1',
  };

  function media(over: Partial<any> = {}) {
    return {
      post_id: '17900000000000001',
      shortcode: 'DAbc123xyz',
      url: 'https://www.instagram.com/reel/DAbc123xyz/',
      description: 'Nhẫn kim hoa #K101',
      hashtags: ['K101'],
      thumbnail_url: 'https://cdn/t.jpg',
      media_product_type: 'REELS',
      likes_count: 12,
      comments_count: 3,
      date_posted: '2026-08-15T03:00:00+0000',
      view_count: 4200,
      ...over,
    };
  }

  beforeEach(() => {
    prisma = {
      video_management_managedfacebookpage: { findMany: jest.fn(async () => PAGES) },
      scraperInstagramProfile: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 10n, ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 10n, ...data })),
      },
      scraperInstagramReel: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => data),
        update: jest.fn(async ({ data }: any) => data),
      },
    };
    aiClient = {
      fetchOwnedAccount: jest.fn(async (pageId: string) => (pageId === 'p1' ? ACCOUNT : null)),
      fetchMedia: jest.fn(async () => [media()]),
    };
    service = new InstagramOwnedAccountsService(prisma, aiClient as any);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('importOwnedAccounts', () => {
    it('chỉ tạo hồ sơ cho page có nối Instagram', async () => {
      const kq = await service.importOwnedAccounts();

      expect(kq.created).toBe(1);
      expect(prisma.scraperInstagramProfile.create).toHaveBeenCalledTimes(1);
    });

    it('page không nối Instagram bỏ qua êm, không tính là lỗi', async () => {
      const kq = await service.importOwnedAccounts();

      expect(kq.failed).toBe(0);
      expect(kq.skipped).toBe(1);
    });

    it('một page hỏng không làm đứt các page còn lại', async () => {
      aiClient.fetchOwnedAccount.mockImplementationOnce(async () => {
        throw new Error('AI service 502');
      });

      const kq = await service.importOwnedAccounts();

      expect(kq.failed).toBe(1);
      expect(aiClient.fetchOwnedAccount).toHaveBeenCalledTimes(2); // vẫn hỏi page thứ hai
    });

    it('hồ sơ đã có thì cập nhật chứ không tạo trùng — username là khoá UNIQUE', async () => {
      prisma.scraperInstagramProfile.findUnique.mockResolvedValue({ id: 10n, username: ACCOUNT.username });

      const kq = await service.importOwnedAccounts();

      expect(kq.created).toBe(0);
      expect(kq.updated).toBe(1);
      expect(prisma.scraperInstagramProfile.create).not.toHaveBeenCalled();
    });
  });

  describe('syncAccountMedia', () => {
    it('ghi bài mới kèm đủ trường bắt buộc của bảng reel', async () => {
      await service.syncAccountMedia({ id: 10n, instagram_id: ACCOUNT.instagram_id } as any, 'tok1');

      const { data } = prisma.scraperInstagramReel.create.mock.calls[0][0];
      expect(data.post_id).toBe('17900000000000001');
      expect(data.shortcode).toBe('DAbc123xyz');
      expect(data.profile_id).toBe(10n);
      expect(data.date_posted).toBeInstanceOf(Date);
      expect(data.play_count).toBe(4200n);
    });

    it('view_count null thì GIỮ NGUYÊN số cũ, tuyệt đối không ghi 0 đè', async () => {
      prisma.scraperInstagramReel.findUnique.mockResolvedValue({ id: 5n, play_count: 9999n });
      aiClient.fetchMedia.mockResolvedValue([media({ view_count: null })]);

      await service.syncAccountMedia({ id: 10n, instagram_id: ACCOUNT.instagram_id } as any, 'tok1');

      const { data } = prisma.scraperInstagramReel.update.mock.calls[0][0];
      expect(data.play_count).toBe(9999n);
    });

    it('bài chưa từng có mà view_count null thì để 0, không phải null (cột NOT NULL)', async () => {
      aiClient.fetchMedia.mockResolvedValue([media({ view_count: null })]);

      await service.syncAccountMedia({ id: 10n, instagram_id: ACCOUNT.instagram_id } as any, 'tok1');

      const { data } = prisma.scraperInstagramReel.create.mock.calls[0][0];
      expect(data.play_count).toBe(0n);
    });

    it('bài thiếu shortcode thì bỏ qua — cột đó UNIQUE và NOT NULL, ghi vào là vỡ', async () => {
      aiClient.fetchMedia.mockResolvedValue([media({ shortcode: '' })]);

      const kq = await service.syncAccountMedia({ id: 10n, instagram_id: ACCOUNT.instagram_id } as any, 'tok1');

      expect(kq.created).toBe(0);
      expect(prisma.scraperInstagramReel.create).not.toHaveBeenCalled();
    });
  });
});
