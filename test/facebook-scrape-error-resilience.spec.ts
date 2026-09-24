import { FacebookOwnedPagesService } from '../src/modules/facebook-owned-pages/facebook-owned-pages.service';

describe('Facebook Owned Pages - Scrape Error Resilience & Stale Cleanup', () => {
  let service: FacebookOwnedPagesService;
  let prismaMock: any;
  let aiClientMock: any;

  beforeEach(() => {
    prismaMock = {
      video_management_managedfacebookpage: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
    };
    aiClientMock = {
      fetchManagedPages: jest.fn(),
    };
    service = new FacebookOwnedPagesService(prismaMock, aiClientMock);
  });

  describe('isTransientError', () => {
    it('nhận diện đúng các lỗi mạng tạm thời (DNS, urllib3, connection pool, 502, timeout)', () => {
      expect(
        service.isTransientError(
          "HTTPSConnectionPool(host='graph.facebook.com', port=443): Max retries exceeded with url: ... (Caused by NameResolutionError)",
        ),
      ).toBe(true);

      expect(service.isTransientError('Request failed with status code 502')).toBe(true);
      expect(service.isTransientError('connect ETIMEDOUT 157.240.241.35:443')).toBe(true);
      expect(service.isTransientError('getaddrinfo ENOTFOUND graph.facebook.com')).toBe(true);
      expect(service.isTransientError('Temporary failure in name resolution')).toBe(true);
      expect(service.isTransientError('Request failed with status code 429')).toBe(true);
      expect(service.isTransientError('Too Many Requests')).toBe(true);
    });

    it('không nhận nhầm lỗi phân quyền hoặc token chết thành lỗi tạm thời', () => {
      expect(service.isTransientError('Error validating access token: Session has expired')).toBe(false);
      expect(service.isTransientError('OAuthException: (#200) Provide valid app secret proof')).toBe(false);
      expect(service.isTransientError('Page has been deleted or unpublished')).toBe(false);
    });
  });

  describe('clearTransientScrapeErrors', () => {
    it('chỉ xoá scrape_error cho các kênh dính lỗi mạng tạm thời, giữ nguyên lỗi thật', async () => {
      prismaMock.video_management_managedfacebookpage.findMany.mockResolvedValue([
        {
          id: 1n,
          scrape_error: "HTTPSConnectionPool(host='graph.facebook.com', port=443): Max retries exceeded (Caused by NameResolutionError)",
        },
        {
          id: 2n,
          scrape_error: 'OAuthException: Session has expired',
        },
        {
          id: 3n,
          scrape_error: 'Request failed with status code 502',
        },
      ]);
      prismaMock.video_management_managedfacebookpage.updateMany.mockResolvedValue({ count: 2 });

      const clearedCount = await service.clearTransientScrapeErrors();

      expect(clearedCount).toBe(2);
      expect(prismaMock.video_management_managedfacebookpage.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1n, 3n] } },
        data: { scrape_error: null, updated_at: expect.any(Date) },
      });
    });
  });

  describe('importManagedPages', () => {
    it('tự động reset scrape_error về null khi import thành công kênh từng bị lỗi mạng tạm thời', async () => {
      aiClientMock.fetchManagedPages.mockResolvedValue({
        pages: [
          {
            page_id: 'page_123',
            name: 'Page Test',
            username: 'pagetest',
            category: 'Jewelry',
            avatar_url: 'https://example.com/avatar.jpg',
            followers_count: 500,
            likes_count: 400,
            page_access_token_encrypted: 'enc_token',
            raw_data: {},
          },
        ],
      });

      prismaMock.video_management_managedfacebookpage.findUnique.mockResolvedValue({
        id: 10n,
        page_id: 'page_123',
        scrape_error: 'connect ETIMEDOUT',
      });
      prismaMock.video_management_managedfacebookpage.update.mockResolvedValue({});

      const result = await service.importManagedPages();

      expect(result.updated).toBe(1);
      expect(prismaMock.video_management_managedfacebookpage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { page_id: 'page_123' },
          data: expect.objectContaining({
            scrape_error: null,
            is_active: true,
          }),
        }),
      );
    });
  });
});
