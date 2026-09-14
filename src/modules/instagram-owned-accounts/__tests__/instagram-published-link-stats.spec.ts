import { InstagramOwnedAccountsService } from '../instagram-owned-accounts.service';

/**
 * fetchStatsForUrl() — kéo view/like/comment cho 1 URL bài đăng Instagram bất kỳ dán vào Task
 * (PublishedLinksSection), tương tự FacebookOwnedPagesService.fetchStatsForUrl(). Chỉ hoạt động
 * với reel/video ĐÃ TỪNG ĐỒNG BỘ từ kênh nội bộ (is_owned=true, xem instagram-owned-sync.spec.ts)
 * vì cần access token của tài khoản đã kết nối OAuth để gọi Graph API — không đọc được kênh
 * Instagram ngoài hệ thống.
 */
describe('InstagramOwnedAccountsService.fetchStatsForUrl', () => {
  const buildService = (overrides: { reel?: any; accounts?: any[] } = {}) => {
    const prisma = {
      scraperInstagramReel: {
        findUnique: jest.fn().mockResolvedValue(overrides.reel ?? null),
      },
      socialAccount: {
        findMany: jest.fn().mockResolvedValue(overrides.accounts ?? []),
      },
    };
    const crypto = { decrypt: jest.fn().mockReturnValue('token-that') };
    const service = new InstagramOwnedAccountsService(prisma as never, crypto as never);
    return { service, prisma, crypto };
  };

  const ownedReel = (over: Record<string, unknown> = {}) => ({
    post_id: 'media-1',
    shortcode: 'ABC123',
    profile: { is_owned: true, instagram_id: 'ig-user-1' },
    ...over,
  });

  const account = (over: Record<string, unknown> = {}) => ({
    id: 'sa-1',
    platform_id: 'ig-user-1',
    access_token_enc: 'enc',
    extra_data: { type: 'instagram_business', igUserId: 'ig-user-1' },
    ...over,
  });

  it('URL không nhận diện được shortcode → unsupported, không đụng DB', async () => {
    const { service, prisma } = buildService();

    const result = await service.fetchStatsForUrl('https://example.com/khong-phai-instagram');

    expect(result).toEqual({ status: 'unsupported' });
    expect(prisma.scraperInstagramReel.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['https://www.instagram.com/reel/ABC123/', 'ABC123'],
    ['https://www.instagram.com/p/ABC123/?igsh=xyz', 'ABC123'],
    ['https://www.instagram.com/someuser/reel/ABC123/', 'ABC123'],
  ])('bóc đúng shortcode từ %s và tra theo shortcode đó', async (url, expectedShortcode) => {
    const { service, prisma } = buildService();

    await service.fetchStatsForUrl(url);

    expect(prisma.scraperInstagramReel.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { shortcode: expectedShortcode } }),
    );
  });

  it('không tìm thấy reel trong kho → unsupported', async () => {
    const { service } = buildService({ reel: null });

    const result = await service.fetchStatsForUrl('https://www.instagram.com/reel/KHONGCO/');

    expect(result).toEqual({ status: 'unsupported' });
  });

  it('reel tồn tại nhưng thuộc kênh KHÔNG PHẢI nội bộ (is_owned=false) → unsupported', async () => {
    const { service } = buildService({ reel: ownedReel({ profile: { is_owned: false, instagram_id: 'ig-user-1' } }) });

    const result = await service.fetchStatsForUrl('https://www.instagram.com/reel/ABC123/');

    expect(result).toEqual({ status: 'unsupported' });
  });

  it('reel thuộc kênh nội bộ nhưng chưa có instagram_id (chưa từng sync profile) → unsupported', async () => {
    const { service } = buildService({ reel: ownedReel({ profile: { is_owned: true, instagram_id: null } }) });

    const result = await service.fetchStatsForUrl('https://www.instagram.com/reel/ABC123/');

    expect(result).toEqual({ status: 'unsupported' });
  });

  it('không có SocialAccount nào khớp Instagram User ID của kênh → unsupported', async () => {
    const { service } = buildService({ reel: ownedReel(), accounts: [account({ extra_data: { igUserId: 'ig-user-khac' } })] });

    const result = await service.fetchStatsForUrl('https://www.instagram.com/reel/ABC123/');

    expect(result).toEqual({ status: 'unsupported' });
  });

  /**
   * Ca thật ngày 27/08/2026: reconnect để cấp quyền instagram_manage_insights tạo ra 1 dòng
   * SocialAccount MỚI (khác user_id) thay vì ghi đè dòng cũ — 1 kênh có 2 dòng cùng active,
   * dòng cũ vẫn mang token thiếu quyền. Không sắp theo created_at DESC thì kết quả phụ thuộc
   * thứ tự ngẫu nhiên Postgres trả về, có thể vẫn chọn nhầm token cũ dù đã reconnect xong.
   */
  it('kênh có nhiều SocialAccount active song song → luôn dùng dòng MỚI TẠO nhất (created_at desc)', async () => {
    const { service, prisma, crypto } = buildService({ reel: ownedReel() });
    // orderBy created_at desc thật sự trả mới nhất trước — mock mô phỏng đúng thứ tự đó.
    prisma.socialAccount.findMany.mockImplementation((args: any) => {
      expect(args.orderBy).toEqual({ created_at: 'desc' });
      return Promise.resolve([account({ id: 'sa-new', access_token_enc: 'token-new' }), account({ id: 'sa-old', access_token_enc: 'token-old' })]);
    });
    crypto.decrypt.mockImplementation((enc: string) => enc);
    jest.spyOn(service, 'fetchMediaMetrics').mockResolvedValue({ like_count: 1, comments_count: 1 });
    jest.spyOn(service, 'fetchMediaViews').mockResolvedValue(1);

    await service.fetchStatsForUrl('https://www.instagram.com/reel/ABC123/');

    expect(crypto.decrypt).toHaveBeenCalledWith('token-new');
  });

  it('token đã lưu bị hỏng (giải mã lỗi) → failed, không throw', async () => {
    const { service, crypto } = buildService({ reel: ownedReel(), accounts: [account()] });
    crypto.decrypt.mockImplementation(() => {
      throw new Error('bad key');
    });

    const result = await service.fetchStatsForUrl('https://www.instagram.com/reel/ABC123/');

    expect(result.status).toBe('failed');
    expect(result.error).toContain('bad key');
  });

  it('gọi Graph API thành công → trả đúng views/likes/comments, đúng access token + base URL theo type kết nối', async () => {
    const { service } = buildService({ reel: ownedReel(), accounts: [account()] });
    const metricsSpy = jest.spyOn(service, 'fetchMediaMetrics').mockResolvedValue({ like_count: 20, comments_count: 5 });
    const viewsSpy = jest.spyOn(service, 'fetchMediaViews').mockResolvedValue(800);

    const result = await service.fetchStatsForUrl('https://www.instagram.com/reel/ABC123/');

    expect(result).toEqual({ status: 'success', views: 800, likes: 20, comments: 5 });
    expect(metricsSpy).toHaveBeenCalledWith('https://graph.facebook.com/v21.0', 'media-1', 'token-that');
    expect(viewsSpy).toHaveBeenCalledWith('https://graph.facebook.com/v21.0', 'media-1', 'token-that');
  });

  it('kênh kết nối qua luồng instagram_direct → gọi graph.instagram.com thay vì graph.facebook.com', async () => {
    const { service } = buildService({
      reel: ownedReel(),
      accounts: [account({ extra_data: { type: 'instagram_direct', igUserId: 'ig-user-1' } })],
    });
    jest.spyOn(service, 'fetchMediaMetrics').mockResolvedValue({ like_count: 1, comments_count: 1 });
    const viewsSpy = jest.spyOn(service, 'fetchMediaViews').mockResolvedValue(1);

    await service.fetchStatsForUrl('https://www.instagram.com/reel/ABC123/');

    expect(viewsSpy).toHaveBeenCalledWith('https://graph.instagram.com/v21.0', 'media-1', 'token-that');
  });

  it('Graph API không lấy được metrics (page/media lỗi) → failed', async () => {
    const { service } = buildService({ reel: ownedReel(), accounts: [account()] });
    jest.spyOn(service, 'fetchMediaMetrics').mockResolvedValue(null);
    jest.spyOn(service, 'fetchMediaViews').mockResolvedValue(0);

    const result = await service.fetchStatsForUrl('https://www.instagram.com/reel/ABC123/');

    expect(result.status).toBe('failed');
  });

  it('gọi Graph API throw exception (mạng lỗi) → failed, không throw ra ngoài', async () => {
    const { service } = buildService({ reel: ownedReel(), accounts: [account()] });
    jest.spyOn(service, 'fetchMediaMetrics').mockRejectedValue(new Error('network down'));

    const result = await service.fetchStatsForUrl('https://www.instagram.com/reel/ABC123/');

    expect(result).toEqual({ status: 'failed', error: 'network down' });
  });
});
