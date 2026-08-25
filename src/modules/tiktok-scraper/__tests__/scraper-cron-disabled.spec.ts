import { TiktokScraperCronService } from '../tiktok-scraper-cron.service';
import { DouyinScraperCronService } from '../../douyin-scraper/douyin-scraper-cron.service';
import { XiaohongshuScraperCronService } from '../../xiaohongshu-scraper/xiaohongshu-scraper-cron.service';
import { InstagramScraperCronService } from '../../instagram-scraper/instagram-scraper-cron.service';
import { KuaishouScraperCronService } from '../../kuaishou-scraper/kuaishou-scraper-cron.service';
import { BilibiliScraperCronService } from '../../bilibili-scraper/bilibili-scraper-cron.service';
import { YoutubeScraperCronService } from '../../youtube-scraper/youtube-scraper-cron.service';
import { FacebookExternalScraperCronService } from '../../facebook-external-scraper/facebook-external-scraper-cron.service';
import { ChannelEnrichmentCronService } from '../../channel-enrichment/channel-enrichment-cron.service';

describe('Scraper Cron Services (Manual Invocation & Exception Safety)', () => {
  describe('TiktokScraperCronService', () => {
    let service: TiktokScraperCronService;
    let mockScraper: any;

    beforeEach(() => {
      mockScraper = {
        periodicRefresh: jest.fn().mockResolvedValue({ total: 1, done: 1, failed: 0 }),
        autoRerunTopKeywords: jest.fn().mockResolvedValue({ keywords: ['test'], created: 5, updated: 2 }),
      };
      service = new TiktokScraperCronService(mockScraper);
    });

    it('should invoke periodicRefresh without crashing', async () => {
      await expect(service.cronPeriodicRefresh()).resolves.toBeUndefined();
      expect(mockScraper.periodicRefresh).toHaveBeenCalled();
    });

    it('should safely handle errors in periodicRefresh', async () => {
      mockScraper.periodicRefresh.mockRejectedValue(new Error('TikHub network down'));
      await expect(service.cronPeriodicRefresh()).resolves.toBeUndefined();
    });

    it('should invoke autoRerunTopKeywords without crashing', async () => {
      await expect(service.cronAutoRerunKeywords()).resolves.toBeUndefined();
      expect(mockScraper.autoRerunTopKeywords).toHaveBeenCalled();
    });

    it('should safely handle errors in autoRerunTopKeywords', async () => {
      mockScraper.autoRerunTopKeywords.mockRejectedValue(new Error('Rate limit'));
      await expect(service.cronAutoRerunKeywords()).resolves.toBeUndefined();
    });
  });

  describe('DouyinScraperCronService', () => {
    let service: DouyinScraperCronService;
    let mockScraper: any;

    beforeEach(() => {
      mockScraper = {
        periodicRefresh: jest.fn().mockResolvedValue({ total: 0, done: 0, failed: 0 }),
        autoRerunTopKeywords: jest.fn().mockResolvedValue({ keywords: [], created: 0, updated: 0 }),
      };
      service = new DouyinScraperCronService(mockScraper);
    });

    it('should invoke periodicRefresh and catch errors gracefully', async () => {
      mockScraper.periodicRefresh.mockRejectedValue(new Error('Douyin error'));
      await expect(service.cronPeriodicRefresh()).resolves.toBeUndefined();
    });
  });

  describe('XiaohongshuScraperCronService', () => {
    let service: XiaohongshuScraperCronService;
    let mockScraper: any;

    beforeEach(() => {
      mockScraper = {
        periodicRefresh: jest.fn().mockResolvedValue({ total: 0, done: 0, failed: 0 }),
        autoRerunTopKeywords: jest.fn().mockResolvedValue({ keywords: [], created: 0, updated: 0 }),
      };
      service = new XiaohongshuScraperCronService(mockScraper);
    });

    it('should invoke periodicRefresh and catch errors gracefully', async () => {
      mockScraper.periodicRefresh.mockRejectedValue(new Error('XHS error'));
      await expect(service.cronPeriodicRefresh()).resolves.toBeUndefined();
    });
  });

  describe('InstagramScraperCronService', () => {
    let service: InstagramScraperCronService;
    let mockScraper: any;

    beforeEach(() => {
      mockScraper = {
        periodicRefresh: jest.fn().mockResolvedValue({ total: 0, done: 0, failed: 0 }),
      };
      service = new InstagramScraperCronService(mockScraper);
    });

    it('should invoke periodicRefresh and catch errors gracefully', async () => {
      mockScraper.periodicRefresh.mockRejectedValue(new Error('IG error'));
      await expect(service.cronPeriodicRefresh()).resolves.toBeUndefined();
    });
  });

  describe('KuaishouScraperCronService & BilibiliScraperCronService', () => {
    it('should handle Kuaishou and Bilibili refresh gracefully', async () => {
      const mockKs = {
        periodicRefresh: jest.fn().mockRejectedValue(new Error('KS err')),
        autoRerunTopKeywords: jest.fn().mockResolvedValue({ keywords: [], created: 0, updated: 0 }),
      };
      const ksService = new KuaishouScraperCronService(mockKs as any);
      await expect(ksService.cronPeriodicRefresh()).resolves.toBeUndefined();

      const mockBili = {
        periodicRefresh: jest.fn().mockRejectedValue(new Error('Bili err')),
        autoRerunTopKeywords: jest.fn().mockResolvedValue({ keywords: [], created: 0, updated: 0 }),
      };
      const biliService = new BilibiliScraperCronService(mockBili as any);
      await expect(biliService.cronPeriodicRefresh()).resolves.toBeUndefined();
    });
  });

  describe('YoutubeScraperCronService & FacebookExternalScraperCronService', () => {
    it('should handle YouTube and FB external refresh gracefully', async () => {
      const mockYt = { periodicRefresh: jest.fn().mockRejectedValue(new Error('YT err')) };
      const ytService = new YoutubeScraperCronService(mockYt as any);
      await expect(ytService.cronPeriodicRefresh()).resolves.toBeUndefined();

      const mockFb = { periodicRefresh: jest.fn().mockRejectedValue(new Error('FB err')) };
      const fbService = new FacebookExternalScraperCronService(mockFb as any);
      await expect(fbService.cronPeriodicRefresh()).resolves.toBeUndefined();
    });
  });

  describe('ChannelEnrichmentCronService', () => {
    let service: ChannelEnrichmentCronService;
    let mockPrisma: any;
    let mockEnrichment: any;

    beforeEach(() => {
      mockPrisma = {
        trackedChannel: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      mockEnrichment = {
        enrichBatch: jest.fn().mockResolvedValue({ ok: 0, failed: 0 }),
      };
      service = new ChannelEnrichmentCronService(mockPrisma, mockEnrichment);
    });

    it('should execute handlePeriodicChannelEnrichment without crashing when no channels', async () => {
      await expect(service.handlePeriodicChannelEnrichment()).resolves.toBeUndefined();
      expect(mockPrisma.trackedChannel.findMany).toHaveBeenCalled();
    });

    it('should execute triggerManualFullScan when requested', async () => {
      mockPrisma.trackedChannel.findMany.mockResolvedValue([
        { user_id: 'u1', platform: 'TIKTOK', username: 'chan1' },
      ]);
      mockEnrichment.enrichBatch.mockResolvedValue({ ok: 1, failed: 0 });

      const result = await service.triggerManualFullScan();
      expect(result.ok).toBe(1);
      expect(mockEnrichment.enrichBatch).toHaveBeenCalled();
    });
  });
});
