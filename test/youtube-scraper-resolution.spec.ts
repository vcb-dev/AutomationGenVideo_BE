import { YoutubeScraperService } from '../src/modules/youtube-scraper/youtube-scraper.service';
import { YoutubeScraperController } from '../src/modules/youtube-scraper/youtube-scraper.controller';

describe('YouTube Scraper URL Resolution & Zero-Shorts Resilience', () => {
  let prismaMock: any;
  let aiClientMock: any;
  let metricsServiceMock: any;
  let growthAlertMock: any;
  let service: YoutubeScraperService;

  beforeEach(() => {
    prismaMock = {
      scraperYoutubeProfile: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      scraperYoutubeShort: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    aiClientMock = {
      fetchChannel: jest.fn(),
    };

    const notificationsMock = {
      broadcastToActiveUsers: jest.fn().mockResolvedValue(undefined),
    };

    service = new YoutubeScraperService(
      prismaMock,
      aiClientMock,
      notificationsMock as any,
    );
  });

  describe('resolveToChannelId (via scrapeChannel)', () => {
    it('giữ nguyên nếu input đã là UC... chuẩn', async () => {
      const standardChannelId = 'UC1234567890123456789012';
      prismaMock.scraperYoutubeProfile.findUnique.mockResolvedValue({
        id: 1n,
        channel_id: standardChannelId,
        title: 'Test Channel',
        scraping_status: 'completed',
        is_initial_scraped: true,
      });

      aiClientMock.fetchChannel.mockResolvedValue({
        channel_api_ok: true,
        profile: { channel_id: standardChannelId, title: 'Test Channel', subscriber_count: 1000 },
        shorts: [],
      });

      const res = await service.scrapeChannel(standardChannelId, false, 20);
      expect(res.status).toBe('ok');
      expect(prismaMock.scraperYoutubeProfile.findUnique).toHaveBeenCalledWith({
        where: { channel_id: standardChannelId },
      });
    });

    it('bóc đúng channelId từ HTML khi input là URL video hoặc handle có/không có @', async () => {
      const mockHtml = `
        <html>
          <head>
            <meta itemprop="channelId" content="UCAhfSPCb_HzvHSI54YCZ6GA">
            <script>var ytInitialData = {"externalChannelId":"UCAhfSPCb_HzvHSI54YCZ6GA"};</script>
          </head>
        </html>
      `;

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue(mockHtml),
      } as any);

      try {
        const resolved = await (service as any).resolveToChannelId('https://www.youtube.com/watch?v=4JFshXlwShY');
        expect(resolved).toBe('UCAhfSPCb_HzvHSI54YCZ6GA');

        const resolvedFromHandle = await (service as any).resolveToChannelId('@Wxrdie');
        expect(resolvedFromHandle).toBe('UCAhfSPCb_HzvHSI54YCZ6GA');
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('https://www.youtube.com/@Wxrdie'),
          expect.any(Object),
        );
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('Kênh không có video Shorts (0 Shorts)', () => {
    it('không ném 404, không xóa profile, lưu profile với trạng thái completed', async () => {
      const channelId = 'UCHUTQEYjDPKWGhE87pH49-w';
      const createdProfile = {
        id: 99n,
        channel_id: channelId,
        url: `https://www.youtube.com/channel/${channelId}`,
        title: 'Wind Music',
        scraping_status: 'idle',
        is_initial_scraped: false,
      };

      prismaMock.scraperYoutubeProfile.findUnique.mockResolvedValueOnce(null); // wasCreated = true
      prismaMock.scraperYoutubeProfile.create.mockResolvedValue(createdProfile);
      prismaMock.scraperYoutubeProfile.update.mockResolvedValue(createdProfile);
      prismaMock.scraperYoutubeProfile.findUniqueOrThrow.mockResolvedValue({
        ...createdProfile,
        title: 'Wind Music',
        avatar_url: 'https://example.com/avatar.jpg',
        subscriber_count: 50000n,
        video_count: 26,
        scraping_status: 'completed',
      });

      // AI client trả channel info nhưng 0 Shorts
      aiClientMock.fetchChannel.mockResolvedValue({
        channel_api_ok: true,
        profile: {
          channel_id: channelId,
          title: 'Wind Music',
          avatar_url: 'https://example.com/avatar.jpg',
          subscriber_count: 50000,
          video_count: 26,
        },
        shorts: [],
      });

      const res = await service.scrapeChannel(channelId, false, 20);

      // Không được xóa profile khi kênh hợp lệ
      expect(prismaMock.scraperYoutubeProfile.delete).not.toHaveBeenCalled();
      expect(res.status).toBe('ok');
      expect(res.message).toContain('Wind Music');
      expect(res.message).toContain('chưa có video/Shorts nào');
      expect(res.initial_shorts_count).toBe(0);
      expect(res.profile.title).toBe('Wind Music');
      expect(res.profile.scraping_status).toBe('completed');
    });
  });

  describe('Controller URL parsing', () => {
    it('bóc đúng candidate từ các định dạng URL và handle khác nhau', async () => {
      const readServiceMock: any = {};
      const controller = new YoutubeScraperController(service, readServiceMock);

      const scrapeSpy = jest.spyOn(service, 'scrapeChannel').mockResolvedValue({ status: 'ok' } as any);

      // 1. Channel URL
      await controller.profileScrape({ channel_id: 'https://www.youtube.com/channel/UC1234567890123456789012' });
      expect(scrapeSpy).toHaveBeenLastCalledWith('UC1234567890123456789012', undefined, 50);

      // 2. Handle URL
      await controller.profileScrape({ channel_id: 'https://www.youtube.com/@Wxrdie' });
      expect(scrapeSpy).toHaveBeenLastCalledWith('Wxrdie', undefined, 50);

      // 3. Handle URL with sub-path (/videos)
      await controller.profileScrape({ channel_id: 'https://www.youtube.com/@Wxrdie/videos' });
      expect(scrapeSpy).toHaveBeenLastCalledWith('Wxrdie', undefined, 50);

      // 4. Bare handle with @
      await controller.profileScrape({ channel_id: '@Wxrdie' });
      expect(scrapeSpy).toHaveBeenLastCalledWith('Wxrdie', undefined, 50);

      // 5. Bare handle without @
      await controller.profileScrape({ channel_id: 'Wxrdie' });
      expect(scrapeSpy).toHaveBeenLastCalledWith('Wxrdie', undefined, 50);

      // 6. Video watch URL
      await controller.profileScrape({ channel_id: 'https://www.youtube.com/watch?v=4JFshXlwShY' });
      expect(scrapeSpy).toHaveBeenLastCalledWith('https://www.youtube.com/watch?v=4JFshXlwShY', undefined, 50);
    });
  });
});
