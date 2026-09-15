import { TiktokScraperService } from '../src/modules/tiktok-scraper/tiktok-scraper.service';
import { FacebookExternalScraperService } from '../src/modules/facebook-external-scraper/facebook-external-scraper.service';
import { InstagramScraperService } from '../src/modules/instagram-scraper/instagram-scraper.service';

describe('Manual and Periodic Sync Channels (Cào tay đa năng)', () => {
  beforeEach(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
      if (typeof fn === 'function') fn();
      return 0 as any;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
  describe('TiktokScraperService.periodicRefresh', () => {
    let service: TiktokScraperService;
    let prismaMock: any;
    let aiClientMock: any;

    beforeEach(() => {
      prismaMock = {
        scraperTikTokProfile: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue([
            { id: 101n, username: 'channel_a', sec_uid: 'sec_a', is_initial_scraped: true },
          ]),
          findUnique: jest.fn().mockResolvedValue({
            id: 101n,
            username: 'channel_a',
            sec_uid: 'sec_a',
            is_initial_scraped: true,
            scraping_status: 'idle',
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      };

      aiClientMock = {
        fetchProfilePosts: jest.fn().mockResolvedValue({
          author: null,
          videos: [
            {
              video_id: 'vid1',
              url: 'https://tiktok.com/@channel_a/video/1',
              description: 'test',
              date_posted: new Date(),
            },
          ],
        }),
      };

      service = new TiktokScraperService(prismaMock, aiClientMock as any, {} as any, {} as any);
      // Mock helper to bypass background redis/db operations inside scrapeProfilePosts
      jest.spyOn(service as any, 'applyAuthorUpdate').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'upsertProfileVideo').mockResolvedValue({ created: 1 });
      jest.spyOn(service as any, 'recordMetricsAndMaybeAlert').mockResolvedValue(undefined);
    });

    it('khi scope = bookmarked, truy vấn đúng kênh đã bookmark và loại trừ kênh nội bộ', async () => {
      await service.periodicRefresh({ scope: 'bookmarked' });

      expect(prismaMock.scraperTikTokProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            is_bookmarked: true,
            is_owned: false,
            scraping_status: { not: 'processing' },
          }),
        }),
      );
    });

    it('khi scope = all, truy vấn toàn bộ kênh khám phá (loại trừ kênh nội bộ)', async () => {
      await service.periodicRefresh({ scope: 'all' });

      expect(prismaMock.scraperTikTokProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            scraping_status: { not: 'processing' },
            is_owned: false,
          },
        }),
      );
    });

    it('khi mode = count, gọi fetchProfilePosts với đúng số lượng count chỉ định', async () => {
      await service.periodicRefresh({ scope: 'tracked', mode: 'count', count: 50 });

      expect(aiClientMock.fetchProfilePosts).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'channel_a',
          count: 50,
        }),
      );
    });

    it('khi mode = days, gọi fetchProfilePosts với đúng số ngày chỉ định', async () => {
      await service.periodicRefresh({ scope: 'tracked', mode: 'days', days: 14 });

      expect(aiClientMock.fetchProfilePosts).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'channel_a',
          days: 14,
        }),
      );
    });
  });

  describe('FacebookExternalScraperService.periodicRefresh', () => {
    let service: FacebookExternalScraperService;
    let prismaMock: any;
    let aiClientMock: any;

    beforeEach(() => {
      prismaMock = {
        scraperFanpage: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue([
            { id: 201n, name: 'Page A', page_url: 'https://facebook.com/pagea', is_initial_scraped: true, last_scraped_at: new Date() },
          ]),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 201n,
            name: 'Page A',
            page_url: 'https://facebook.com/pagea',
            is_initial_scraped: true,
            last_scraped_at: new Date(),
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        scraperFacebookReel: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      aiClientMock = {
        fetchPageReels: jest.fn().mockResolvedValue({
          profile_api_ok: true,
          profile: null,
          reels: [],
        }),
      };

      service = new FacebookExternalScraperService(prismaMock, aiClientMock as any);
      jest.spyOn(service as any, 'ingestFetchedData').mockResolvedValue({ created: 0, updated: 0 });
    });

    it('khi scope = bookmarked, truy vấn đúng page đã lưu trên UI', async () => {
      await service.periodicRefresh({ scope: 'bookmarked' });

      expect(prismaMock.scraperFanpage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            is_visible_on_ui: true,
            is_bookmarked: true,
            scraping_status: { not: 'processing' },
          }),
        }),
      );
    });

    it('khi scope = all, truy vấn toàn bộ page trên UI', async () => {
      await service.periodicRefresh({ scope: 'all' });

      expect(prismaMock.scraperFanpage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            is_visible_on_ui: true,
            scraping_status: { not: 'processing' },
          },
        }),
      );
    });

    it('khi mode = count, gọi fetchPageReels với count chỉ định và startDate rỗng', async () => {
      await service.periodicRefresh({ scope: 'tracked', mode: 'count', count: 30 });

      expect(aiClientMock.fetchPageReels).toHaveBeenCalledWith(
        'https://facebook.com/pagea',
        30,
        [],
        '',
      );
    });

    it('khi mode = days, gọi fetchPageReels với startDate tính theo số ngày', async () => {
      const days = 7;
      const expectedStartDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

      await service.periodicRefresh({ scope: 'tracked', mode: 'days', days });

      expect(aiClientMock.fetchPageReels).toHaveBeenCalledWith(
        'https://facebook.com/pagea',
        50,
        [],
        expectedStartDate,
      );
    });
  });

  describe('InstagramScraperService.periodicRefresh', () => {
    let service: InstagramScraperService;
    let prismaMock: any;
    let aiClientMock: any;

    beforeEach(() => {
      prismaMock = {
        scraperInstagramProfile: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue([
            { id: 301n, username: 'ig_channel', is_initial_scraped: true },
          ]),
          findUnique: jest.fn().mockResolvedValue({
            id: 301n,
            username: 'ig_channel',
            is_initial_scraped: true,
            scraping_status: 'idle',
          }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 301n,
            followers_count: 100n,
            following_count: 50n,
            posts_count: 10,
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
              post_id: 'r1',
              url: 'https://instagram.com/reel/1',
              date_posted: new Date(Date.now() - 2 * 86400000), // 2 days ago
            },
            {
              post_id: 'r2',
              url: 'https://instagram.com/reel/2',
              date_posted: new Date(Date.now() - 10 * 86400000), // 10 days ago
            },
          ],
        }),
      };

      service = new InstagramScraperService(prismaMock, aiClientMock as any);
      jest.spyOn(service as any, 'upsertReel').mockResolvedValue({ created: true });
    });

    it('khi mode = days (7 ngày), chỉ ingest các reel trong vòng 7 ngày qua', async () => {
      await service.periodicRefresh({ scope: 'tracked', mode: 'days', days: 7 });

      // Reel r1 (2 ngày trước) được upsert, reel r2 (10 ngày trước) bị bỏ qua
      expect((service as any).upsertReel).toHaveBeenCalledTimes(1);
      expect((service as any).upsertReel).toHaveBeenCalledWith(
        301n,
        expect.objectContaining({ post_id: 'r1' }),
      );
    });

    it('khi mode = count, ingest tất cả các reel trả về trong phạm vi count', async () => {
      await service.periodicRefresh({ scope: 'tracked', mode: 'count', count: 20 });

      expect((service as any).upsertReel).toHaveBeenCalledTimes(2);
    });
  });
});
