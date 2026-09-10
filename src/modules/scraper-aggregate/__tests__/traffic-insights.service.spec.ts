import { TrafficInsightsService } from '../traffic-insights.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TrafficInsightsService', () => {
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

  describe('Facebook Graph API', () => {
    it('should NOT double-count organic views into total video views', async () => {
      prismaMock.socialAccount.findFirst.mockResolvedValue({
        id: 'acc_fb_1',
        platform: 'FACEBOOK',
        platform_id: '123456789',
        access_token_enc: 'encrypted_token',
      });

      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            { name: 'page_video_views', values: [{ value: 100 }] },
            { name: 'page_video_views_organic', values: [{ value: 80 }] },
            { name: 'page_posts_impressions_organic', values: [{ value: 250 }] },
            { name: 'page_post_engagements', values: [{ value: 15 }] },
          ],
        },
      });

      const result = await service.getTrafficInsights('123456789', '2026-09-07', 'day');

      expect(result.success).toBe(true);
      // Views phải là 250 (khớp với chỉ số Lượt xem trên Meta Business Suite = page_posts_impressions_organic)
      expect(result.views).toBe(250);
      expect(result.videoViewsTotal).toBe(100);
      expect(result.videoViewsOrganic).toBe(80);
      expect(result.impressions).toBe(250);
      expect(result.engagements).toBe(15);
      expect(result.source).toBe('meta_graph_page_insights');
      expect(result.period?.from).toBe('2026-09-07');
      expect(result.period?.to).toBe('2026-09-07');
    });

    it('should fallback to video views if page_posts_impressions_organic is 0', async () => {
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
      expect(result.videoViewsTotal).toBe(120);
    });
  });

  describe('Instagram Graph API', () => {
    it('should retrieve views and reach from Account Insights without estimation', async () => {
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
            { name: 'total_interactions', total_value: { value: 2 } },
          ],
        },
      });

      const result = await service.getTrafficInsights('17841400000000', '2026-09-07', 'day');

      expect(result.success).toBe(true);
      expect(result.views).toBe(71);
      expect(result.reach).toBe(54);
      expect(result.engagements).toBe(2);
      expect(result.source).toBe('instagram_graph_views');
    });

    it('should fallback to reach when views metric is 0', async () => {
      prismaMock.socialAccount.findFirst.mockResolvedValue({
        id: 'acc_ig_2',
        platform: 'INSTAGRAM',
        platform_id: '17841400000001',
        access_token_enc: 'encrypted_token',
      });

      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            { name: 'views', total_value: { value: 0 } },
            { name: 'reach', total_value: { value: 35 } },
            { name: 'total_interactions', total_value: { value: 1 } },
          ],
        },
      });

      const result = await service.getTrafficInsights('17841400000001', '2026-09-07', 'day');
      expect(result.success).toBe(true);
      expect(result.views).toBe(35);
      expect(result.source).toBe('instagram_graph_reach');
    });
  });

  describe('Database fallback', () => {
    it('should calculate views from tracked channel posts for day scope', async () => {
      prismaMock.trackedChannel.findFirst.mockResolvedValue({
        id: 'chan_101',
        username: 'test_channel',
      });

      prismaMock.videoPost.aggregate.mockResolvedValue({
        _sum: { views: 2500 },
      });

      const result = await service.getTrafficInsights('chan_101', '2026-08-20', 'day');
      expect(result.success).toBe(true);
      expect(result.views).toBe(2500);
      expect(result.source).toBe('db_tracked_posts_day');
    });

    it('should calculate views from managed facebook page content for mtd scope', async () => {
      prismaMock.video_management_managedfacebookpage.findFirst.mockResolvedValue({
        id: 202,
        name: 'Managed FB Page',
      });

      prismaMock.video_management_ownedvideocontent.aggregate.mockResolvedValue({
        _sum: { view_count: 4200 },
      });

      const result = await service.getTrafficInsights('Managed FB Page', '2026-08-20', 'mtd');
      expect(result.success).toBe(true);
      expect(result.views).toBe(4200);
      expect(result.source).toBe('db_owned_videos_mtd');
    });
  });
});
