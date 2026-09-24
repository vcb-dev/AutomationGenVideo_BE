import { InstagramScraperService } from '../src/modules/instagram-scraper/instagram-scraper.service';
import { InstagramScraperController } from '../src/modules/instagram-scraper/instagram-scraper.controller';

describe('Instagram Owned Channels Sync All (Cào tất cả video kênh nội bộ)', () => {
  beforeEach(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
      if (typeof fn === 'function') fn();
      return 0 as any;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('InstagramScraperService.periodicRefresh with is_owned = true', () => {
    let service: InstagramScraperService;
    let prismaMock: any;
    let aiClientMock: any;
    let ownedAccountsMock: any;

    beforeEach(() => {
      prismaMock = {
        scraperInstagramProfile: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue([
            { id: 401n, username: 'owned_ig_1', is_owned: true, is_initial_scraped: true },
            { id: 402n, username: 'owned_ig_2', is_owned: true, is_initial_scraped: false },
          ]),
          findUnique: jest.fn().mockResolvedValue({
            id: 401n,
            username: 'owned_ig_1',
            is_owned: true,
            is_initial_scraped: true,
            scraping_status: 'idle',
          }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 401n,
            followers_count: 5000n,
            following_count: 100n,
            posts_count: 25,
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        scraperInstagramProfileMetrics: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      aiClientMock = {
        fetchProfileReels: jest.fn().mockResolvedValue({
          full_profile: null,
          fallback_user: null,
          reels: [
            {
              post_id: 'r_owned_1',
              url: 'https://instagram.com/reel/owned1',
              date_posted: new Date(),
            },
          ],
        }),
      };

      ownedAccountsMock = {
        syncSingleProfileByUsername: jest.fn().mockResolvedValue({
          success: true,
          message: 'Graph API sync ok',
        }),
      };

      service = new InstagramScraperService(
        prismaMock,
        aiClientMock as any,
        ownedAccountsMock as any,
      );
      jest.spyOn(service as any, 'upsertReel').mockResolvedValue({ created: true });
    });

    it('khi is_owned = true và scope = all, tìm đúng các profile có is_owned: true', async () => {
      const res = await service.periodicRefresh({ is_owned: true, scope: 'all' });

      expect(prismaMock.scraperInstagramProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            scraping_status: { not: 'processing' },
            is_owned: true,
          },
        }),
      );
      expect(res.total).toBe(2);
      expect(res.done).toBe(2);
      expect(res.failed).toBe(0);
    });

    it('khi is_owned = false (mặc định cho kênh khám phá), tìm đúng is_owned: false', async () => {
      await service.periodicRefresh({ scope: 'tracked' });

      expect(prismaMock.scraperInstagramProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            scraping_status: { not: 'processing' },
            is_owned: false,
            is_tracked: true,
          },
        }),
      );
    });

    it('khi TikHub lỗi với kênh nội bộ có OAuth, tự động fallback sang syncSingleProfileByUsername', async () => {
      jest.spyOn(service, 'scrapeProfileReels').mockRejectedValueOnce(new Error('TikHub 429 rate limited'));

      const res = await service.periodicRefresh({ is_owned: true });

      expect(ownedAccountsMock.syncSingleProfileByUsername).toHaveBeenCalledWith('owned_ig_1');
      expect(res.done).toBe(2);
      expect(res.failed).toBe(0);
    });
  });

  describe('InstagramScraperController.syncAll', () => {
    let controller: InstagramScraperController;
    let serviceMock: any;
    let readServiceMock: any;

    beforeEach(() => {
      serviceMock = {
        periodicRefresh: jest.fn().mockResolvedValue({ total: 5, done: 5, failed: 0 }),
      };
      readServiceMock = {};
      controller = new InstagramScraperController(serviceMock, readServiceMock);
    });

    it('gọi periodicRefresh với đúng tham số is_owned: true', async () => {
      const res = await controller.syncAll({
        is_owned: true,
        scope: 'all',
        mode: 'count',
        count: 50,
      });

      expect(serviceMock.periodicRefresh).toHaveBeenCalledWith({
        is_owned: true,
        scope: 'all',
        mode: 'count',
        count: 50,
      });
      expect(res.status).toBe('ok');
      expect(res.message).toContain('kênh nội bộ');
      expect(res.message).toContain('50 video mới nhất');
    });
  });
});
