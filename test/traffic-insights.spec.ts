import { TrafficInsightsService } from '../src/modules/scraper-aggregate/traffic-insights.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TrafficInsightsService - Công thức tính số view SUM(impressions)', () => {
  let service: TrafficInsightsService;
  let prismaMock: any;
  let cryptoMock: any;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock = {
      channel: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      socialAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      video_management_managedfacebookpage: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      trackedChannel: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      video_management_ownedvideocontent: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { view_count: 0 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      videoPost: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { views: 0 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      scraperInstagramProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      adsCampaignStats: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { impressions: 0, reach: 0, spend: 0, clicks: 0 } }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      socialVideoReport: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { views: 0 } }),
      },
    };

    cryptoMock = {
      decrypt: jest.fn().mockReturnValue('decrypted_token'),
    };

    service = new TrafficInsightsService(prismaMock, cryptoMock);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return success with 0 views when channel is not found', async () => {
    const result = await service.getTrafficInsights('non-existent-channel');
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.views).toBe(0);
  });

  describe('Facebook Graph API - Tính view theo SUM(impressions) và page_media_view', () => {
    it('ưu tiên page_media_view làm số view chuẩn Meta Business Suite & Smart BI', async () => {
      prismaMock.socialAccount.findFirst.mockResolvedValue({
        id: 'acc_fb_media',
        platform: 'FACEBOOK',
        platform_id: '123456789',
        access_token_enc: 'encrypted_token',
      });

      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            { name: 'page_media_view', values: [{ value: 616008 }] },
            { name: 'page_video_views', values: [{ value: 219347 }] },
          ],
        },
      });

      const result = await service.getTrafficInsights('123456789', '2026-09-10', 'mtd');

      expect(result.success).toBe(true);
      expect(result.views).toBe(616008);
      expect(result.source).toBe('meta_graph_page_media_view');
    });

    it('ưu tiên lấy post impressions (lượt hiển thị bài viết) làm view nếu không có page_media_view', async () => {
      prismaMock.socialAccount.findFirst.mockResolvedValue({
        id: 'acc_fb_1',
        platform: 'FACEBOOK',
        platform_id: '123456789',
        access_token_enc: 'encrypted_token',
      });

      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            { name: 'page_impressions', values: [{ value: 500 }] },
            { name: 'page_posts_impressions', values: [{ value: 450 }] },
            { name: 'page_posts_impressions_organic', values: [{ value: 250 }] },
            { name: 'page_video_views', values: [{ value: 100 }] },
            { name: 'page_post_engagements', values: [{ value: 15 }] },
          ],
        },
      });

      const result = await service.getTrafficInsights('123456789', '2026-09-07', 'day');

      expect(result.success).toBe(true);
      // Views phải là 450 (SUM(page_posts_impressions) = tổng lượt hiển thị bài viết)
      expect(result.views).toBe(450);
      expect(result.impressions).toBe(450);
      expect(result.source).toBe('meta_graph_page_insights');
    });

    it('fallback sang page_posts_impressions_organic nếu không có page_posts_impressions', async () => {
      prismaMock.socialAccount.findFirst.mockResolvedValue({
        id: 'acc_fb_1b',
        platform: 'FACEBOOK',
        platform_id: '123456789',
        access_token_enc: 'encrypted_token',
      });

      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            { name: 'page_posts_impressions_organic', values: [{ value: 250 }] },
            { name: 'page_video_views', values: [{ value: 100 }] },
            { name: 'page_post_engagements', values: [{ value: 15 }] },
          ],
        },
      });

      const result = await service.getTrafficInsights('123456789', '2026-09-07', 'day');

      expect(result.success).toBe(true);
      expect(result.views).toBe(250);
      expect(result.impressions).toBe(250);
    });

    it('fallback sang video views nếu cả post impressions và organic đều = 0', async () => {
      prismaMock.socialAccount.findFirst.mockResolvedValue({
        id: 'acc_fb_2',
        platform: 'FACEBOOK',
        platform_id: 'page_987654321',
        access_token_enc: 'encrypted_token',
      });

      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            { name: 'page_video_views', values: [{ value: 120 }] },
            { name: 'page_video_views_organic', values: [{ value: 45 }] },
            { name: 'page_posts_impressions_organic', values: [{ value: 0 }] },
          ],
        },
      });

      const result = await service.getTrafficInsights('987654321', '2026-09-07', 'day');
      expect(result.success).toBe(true);
      expect(result.views).toBe(120);
    });
  });

  describe('Ads Campaign Stats - Tính view theo SUM(impressions)', () => {
    it('nhận diện Facebook Ads qua prefix ID 120... và tính view = SUM(impressions)', async () => {
      prismaMock.adsCampaignStats.aggregate.mockResolvedValueOnce({
        _sum: {
          impressions: 15420,
          reach: 12300,
          spend: 500000,
          clicks: 1200,
        },
      });

      const result = await service.getTrafficInsights('120250210162810090', '2026-09-01', 'day');
      expect(result.success).toBe(true);
      expect(result.views).toBe(15420);
      expect(result.impressions).toBe(15420);
      expect(result.reach).toBe(12300);
      expect(result.source).toBe('facebook_ads_impressions');
    });

    it('nhận diện TikTok Ads qua prefix ID 185... hoặc 187... và tính view = SUM(impressions)', async () => {
      prismaMock.adsCampaignStats.aggregate.mockResolvedValueOnce({
        _sum: {
          impressions: 329348,
          reach: 280000,
          spend: 1200000,
          clicks: 4500,
        },
      });

      const result = await service.getTrafficInsights('1851234567890123', '2026-09-01', 'day');
      expect(result.success).toBe(true);
      expect(result.views).toBe(329348);
      expect(result.impressions).toBe(329348);
      expect(result.source).toBe('tiktok_ads_impressions');
    });

    it('fallback sang tháng gần nhất nếu tháng hiện tại chưa có dữ liệu Ads', async () => {
      prismaMock.adsCampaignStats.aggregate
        .mockResolvedValueOnce({
          _sum: { impressions: 0, reach: 0, spend: 0, clicks: 0 },
        })
        .mockResolvedValueOnce({
          _sum: { impressions: 2070, reach: 1907, spend: 108485, clicks: 221 },
        });

      prismaMock.adsCampaignStats.findFirst.mockResolvedValueOnce({
        id: 'ads_1',
        year: 2026,
        month: 8,
      });

      const result = await service.getTrafficInsights('120234996259400090', '2026-09-11', 'day');
      expect(result.success).toBe(true);
      expect(result.views).toBe(2070);
      expect(result.impressions).toBe(2070);
      expect(result.source).toBe('facebook_ads_impressions');
      expect(result.period.label).toContain('Tháng 8/2026');
    });
  });

  describe('Instagram Graph API', () => {
    it('lấy views và reach từ Account Insights', async () => {
      prismaMock.socialAccount.findFirst.mockResolvedValue({
        id: 'acc_ig_1',
        platform: 'INSTAGRAM',
        platform_id: '17841400000000',
        access_token_enc: 'encrypted_token',
      });

      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            { name: 'views', total_value: { value: 71 } },
            { name: 'reach', total_value: { value: 54 } },
            { name: 'total_interactions', total_value: { value: 12 } },
          ],
        },
      });

      const result = await service.getTrafficInsights('17841400000000', '2026-09-07', 'day');
      expect(result.success).toBe(true);
      expect(result.views).toBe(71);
      expect(result.impressions).toBe(71);
      expect(result.reach).toBe(54);
      expect(result.engagements).toBe(12);
      expect(result.source).toBe('instagram_graph_views');
    });
  });

  describe('Social Video Report & Tracked Channels', () => {
    it('lấy số views từ social_video_report nếu kênh có dữ liệu video tháng', async () => {
      prismaMock.socialVideoReport.aggregate.mockResolvedValueOnce({
        _sum: { views: 88500 },
      });

      const result = await service.getTrafficInsights('tiktok_channel_vcb', '2026-09-01', 'day', 'TIKTOK');
      expect(result.success).toBe(true);
      expect(result.views).toBe(88500);
      expect(result.impressions).toBe(88500);
      expect(result.source).toBe('social_video_report');
    });

    it('lấy số views từ videoPost nếu kênh là trackedChannel', async () => {
      prismaMock.trackedChannel.findFirst.mockResolvedValueOnce({
        id: 'tc_1',
        username: 'chan_101',
      });
      prismaMock.videoPost.aggregate.mockResolvedValueOnce({
        _sum: { views: 5430 },
      });

      const result = await service.getTrafficInsights('chan_101', '2026-08-20', 'day');
      expect(result.success).toBe(true);
      expect(result.views).toBe(5430);
      expect(result.source).toBe('db_tracked_posts_day');
    });
  });
});
