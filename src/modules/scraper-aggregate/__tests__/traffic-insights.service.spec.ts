import { TrafficInsightsService } from '../traffic-insights.service';

describe('TrafficInsightsService', () => {
  let service: TrafficInsightsService;
  let prismaMock: any;
  let cryptoMock: any;

  beforeEach(() => {
    prismaMock = {
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

  it('should calculate views from tracked channel posts', async () => {
    prismaMock.trackedChannel.findFirst.mockResolvedValue({
      id: 'chan_101',
      username: 'test_channel',
    });

    prismaMock.videoPost.aggregate.mockResolvedValue({
      _sum: { views: 2500 },
    });

    const result = await service.getTrafficInsights('chan_101', '2026-08-20');
    expect(result.success).toBe(true);
    expect(result.views).toBe(2500);
    expect(result.source).toBe('db_tracked_posts_mtd');
  });

  it('should calculate views from managed facebook page content', async () => {
    prismaMock.video_management_managedfacebookpage.findFirst.mockResolvedValue({
      id: 202,
      name: 'Managed FB Page',
    });

    prismaMock.video_management_ownedvideocontent.aggregate.mockResolvedValue({
      _sum: { view_count: 4200 },
    });

    const result = await service.getTrafficInsights('Managed FB Page', '2026-08-20');
    expect(result.success).toBe(true);
    expect(result.views).toBe(4200);
    expect(result.source).toBe('db_owned_videos_mtd');
  });
});
