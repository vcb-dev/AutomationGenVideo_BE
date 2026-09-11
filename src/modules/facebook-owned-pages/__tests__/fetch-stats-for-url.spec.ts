import { Logger } from '@nestjs/common';
import { FacebookOwnedPagesService } from '../facebook-owned-pages.service';

describe('FacebookOwnedPagesService.fetchStatsForUrl — routing Reels + fallback owned content', () => {
  let prisma: any;
  let aiClient: {
    fetchMetricsRefresh: jest.Mock;
    fetchVideoNodeMetrics: jest.Mock;
    resolveOwner: jest.Mock;
  };
  let service: FacebookOwnedPagesService;

  // ID SỐ CÔNG KHAI trên URL /reel/{id} — KHÁC nửa sau của post_id nội bộ {page}_{obj}.
  const REEL_PUBLIC_ID = '1836282150691344';
  const OWNED_COMPOSITE_ID = '148888379055195_1424920569787286';

  function ownedRow(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: 1n,
      post_id: OWNED_COMPOSITE_ID,
      permalink_url: `https://www.facebook.com/reel/${REEL_PUBLIC_ID}/`,
      view_count: 615n,
      like_count: 10,
      comment_count: 2,
      share_count: 0,
      updated_at: new Date(),
      managed_page: { page_id: '148888379055195', page_access_token: 'enc-token' },
      ...over,
    };
  }

  beforeEach(() => {
    prisma = {
      video_management_ownedvideocontent: { findFirst: jest.fn() },
      video_management_managedfacebookpage: { findFirst: jest.fn() },
    };
    aiClient = {
      fetchMetricsRefresh: jest.fn(),
      fetchVideoNodeMetrics: jest.fn(),
      resolveOwner: jest.fn(),
    };
    service = new FacebookOwnedPagesService(prisma, aiClient as any);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('reel ĐÃ sync → gọi fetchVideoNodeMetrics với ID số công khai trên URL, KHÔNG gọi fetchMetricsRefresh', async () => {
    prisma.video_management_ownedvideocontent.findFirst.mockResolvedValue(ownedRow());
    aiClient.fetchVideoNodeMetrics.mockResolvedValue({
      metrics: { [REEL_PUBLIC_ID]: { view_count: 50000, like_count: 30, comment_count: 4, share_count: 0 } },
    });

    const res = await service.fetchStatsForUrl(`https://www.facebook.com/reel/${REEL_PUBLIC_ID}/`);

    expect(aiClient.fetchVideoNodeMetrics).toHaveBeenCalledWith('enc-token', [REEL_PUBLIC_ID]);
    expect(aiClient.fetchMetricsRefresh).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'success', views: 50000, likes: 30, comments: 4, shares: 0 });
  });

  it('link /{page}/videos/{id} (KHÔNG phải reel) → vẫn đi fetchMetricsRefresh kiểu Page Post', async () => {
    prisma.video_management_ownedvideocontent.findFirst.mockResolvedValue(
      ownedRow({ post_id: '111_222', permalink_url: 'https://www.facebook.com/mypage/videos/222/' }),
    );
    aiClient.fetchMetricsRefresh.mockResolvedValue({
      metrics: { '111_222': { view_count: 900, like_count: 1, comment_count: 0, share_count: 5 } },
    });

    const res = await service.fetchStatsForUrl('https://www.facebook.com/mypage/videos/222/');

    expect(aiClient.fetchMetricsRefresh).toHaveBeenCalledWith('enc-token', ['111_222']);
    expect(aiClient.fetchVideoNodeMetrics).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'success', views: 900, likes: 1, comments: 0, shares: 5 });
  });

  it('Graph API trả rỗng cho reel → fallback về số đã sync trong owned content (còn mới)', async () => {
    prisma.video_management_ownedvideocontent.findFirst.mockResolvedValue(
      ownedRow({ view_count: 615n, like_count: 10, comment_count: 2 }),
    );
    aiClient.fetchVideoNodeMetrics.mockResolvedValue({ metrics: {} });

    const res = await service.fetchStatsForUrl(`https://www.facebook.com/reel/${REEL_PUBLIC_ID}/`);

    expect(res).toEqual({ status: 'success', views: 615, likes: 10, comments: 2, shares: 0 });
  });

  it('Graph API rỗng + owned content quá cũ (> 3 ngày) → failed, KHÔNG phục vụ số cũ', async () => {
    const stale = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    prisma.video_management_ownedvideocontent.findFirst.mockResolvedValue(ownedRow({ updated_at: stale }));
    aiClient.fetchVideoNodeMetrics.mockResolvedValue({ metrics: {} });

    const res = await service.fetchStatsForUrl(`https://www.facebook.com/reel/${REEL_PUBLIC_ID}/`);

    expect(res).toEqual({ status: 'failed', error: 'Không lấy được số liệu cho bài viết này' });
  });

  it('Graph API throw cho reel → fallback owned content (còn mới) thay vì crash/failed', async () => {
    prisma.video_management_ownedvideocontent.findFirst.mockResolvedValue(ownedRow({ view_count: 777n }));
    aiClient.fetchVideoNodeMetrics.mockRejectedValue(new Error('502 Bad Gateway'));

    const res = await service.fetchStatsForUrl(`https://www.facebook.com/reel/${REEL_PUBLIC_ID}/`);

    expect(res).toEqual({ status: 'success', views: 777, likes: 10, comments: 2, shares: 0 });
  });

  it('reel CHƯA sync → tra page qua resolveOwner rồi vẫn dùng video-node (hành vi cũ giữ nguyên)', async () => {
    prisma.video_management_ownedvideocontent.findFirst.mockResolvedValue(null);
    prisma.video_management_managedfacebookpage.findFirst
      .mockResolvedValueOnce({ page_access_token: 'lender-enc' }) // resolveOwnerPage mượn token
      .mockResolvedValueOnce({ page_id: 'p1', page_access_token: 'owner-enc' }); // page khớp from_id
    aiClient.resolveOwner.mockResolvedValue({ from_id: 'p1', from_name: 'P', permalink_url: null });
    aiClient.fetchVideoNodeMetrics.mockResolvedValue({
      metrics: { '999888777': { view_count: 12, like_count: 0, comment_count: 0, share_count: 0 } },
    });

    const res = await service.fetchStatsForUrl('https://www.facebook.com/reel/999888777');

    expect(aiClient.fetchVideoNodeMetrics).toHaveBeenCalledWith('owner-enc', ['999888777']);
    expect(aiClient.fetchMetricsRefresh).not.toHaveBeenCalled();
    expect(res.status).toBe('success');
  });
});
