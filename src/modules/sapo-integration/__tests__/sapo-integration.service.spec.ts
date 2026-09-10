import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { SapoIntegrationService } from '../sapo-integration.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SapoOrder } from '../sapo-integration.types';

describe('SapoIntegrationService', () => {
  let service: SapoIntegrationService;
  let httpService: HttpService;
  let prismaService: PrismaService;

  const mockOrders: SapoOrder[] = [
    {
      id: 101,
      name: '#1001',
      source_name: 'Facebook - Page Đồ Da',
      total_price: '500000',
      tags: '[Page: Đồ Da Cao Cấp], [Team K1]',
      status: 'closed',
      financial_status: 'paid',
    },
    {
      id: 102,
      name: '#1002',
      source_name: 'TikTok Shop VN',
      total_price: '750000',
      tags: '[Kênh: TikTok Shop Đồ Da], [Team K1]',
      status: 'closed',
      financial_status: 'paid',
    },
    {
      id: 103,
      name: '#1003',
      source_name: 'Instagram Direct',
      total_price: '300000',
      tags: '[Page: Insta Đồ Da]',
      status: 'open',
      financial_status: 'paid',
    },
    {
      id: 104,
      name: '#1004',
      source_name: 'Zalo OA Shop',
      total_price: '200000',
      status: 'closed',
      financial_status: 'paid',
    },
    {
      id: 105,
      name: '#1005',
      source_name: 'Facebook - Page Đồ Da',
      total_price: '999999',
      status: 'cancelled', // Đơn huỷ — phải bị loại trừ
      financial_status: 'refunded',
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SapoIntegrationService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(() => of({ data: { orders: mockOrders } })),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SAPO_STORE_ALIAS') return 'test-store';
              if (key === 'SAPO_ACCESS_TOKEN') return 'mock-token-123';
              return null;
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            revenueReport: {
              create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 'rec-123', ...args.data })),
            },
            socialAccount: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            channel: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            trackedChannel: {
              findMany: jest.fn().mockResolvedValue([]),
            },
          },
        },
      ],
    }).compile();

    service = module.get<SapoIntegrationService>(SapoIntegrationService);
    httpService = module.get<HttpService>(HttpService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('isConfigured trả về true khi có đầy đủ store alias và access token', () => {
    expect(service.isConfigured()).toBe(true);
  });

  describe('detectPlatformAndChannel', () => {
    it('nhận diện chính xác nền tảng TikTok từ source_name và trích xuất tag kênh', () => {
      const result = service.detectPlatformAndChannel({
        id: 1,
        name: '#1',
        source_name: 'TikTok Shop',
        total_price: '100000',
        tags: '[Kênh: Shop Chính], [Team K1]',
      });

      expect(result.platform).toBe('tiktok');
      expect(result.channelName).toBe('Shop Chính');
      expect(result.team).toBe('Team K1');
    });

    it('nhận diện chính xác Facebook, Instagram, YouTube, Threads, Zalo', () => {
      expect(
        service.detectPlatformAndChannel({
          id: 1,
          name: '#1',
          source_name: 'Facebook Fanpage',
          total_price: '100',
        }).platform,
      ).toBe('fb');

      expect(
        service.detectPlatformAndChannel({
          id: 2,
          name: '#2',
          source_name: 'Instagram',
          total_price: '100',
        }).platform,
      ).toBe('ig');

      expect(
        service.detectPlatformAndChannel({
          id: 3,
          name: '#3',
          source_name: 'YouTube Shorts Shop',
          total_price: '100',
        }).platform,
      ).toBe('yt');

      expect(
        service.detectPlatformAndChannel({
          id: 4,
          name: '#4',
          source_name: 'Threads Commerce',
          total_price: '100',
        }).platform,
      ).toBe('thread');

      expect(
        service.detectPlatformAndChannel({
          id: 5,
          name: '#5',
          source_name: 'Zalo OA',
          total_price: '100',
        }).platform,
      ).toBe('zalo');
    });
  });

  describe('getDailyRevenuePreview', () => {
    it('tổng hợp chính xác doanh thu theo nền tảng, loại bỏ đơn huỷ', async () => {
      const preview = await service.getDailyRevenuePreview('2026-08-29');

      expect(preview.orderCount).toBe(4); // 4 đơn hợp lệ (bỏ 1 đơn cancelled)
      expect(preview.totalRevenue).toBe((500000 + 750000 + 300000 + 200000).toString()); // 1750000
      expect(preview.revenue.fb).toBe('500000');
      expect(preview.revenue.tiktok).toBe('750000');
      expect(preview.revenue.ig).toBe('300000');
      expect(preview.revenue.zalo).toBe('200000');
      expect(preview.revenue.yt).toBe('');
      expect(preview.revenue.thread).toBe('');
      expect(preview.channels.fb).toContain('Đồ Da Cao Cấp');
      expect(preview.channels.tiktok).toContain('TikTok Shop Đồ Da');
    });

    it('lọc theo team thành công khi người dùng truyền teamFilter', async () => {
      const preview = await service.getDailyRevenuePreview('2026-08-29', 'Team K1');

      // Chỉ lấy các đơn có tag Team K1 (#1001 và #1002, bỏ #1005 huỷ) + các đơn không tag team (#1003, #1004)
      expect(Number(preview.revenue.fb)).toBe(500000);
      expect(Number(preview.revenue.tiktok)).toBe(750000);
    });

    it('không bị gộp nhầm các kênh có tên tiền tố tương tự nhau (không dùng substring matching)', async () => {
      // Giả lập 2 đơn từ 2 page khác nhau nhưng cùng tiền tố "HuyK"
      const customOrders: SapoOrder[] = [
        {
          id: 201,
          name: '#2001',
          source_name: 'facebook',
          total_price: '100000',
          tags: 'page_HuyK - Kim Hoàn, page_id_111',
          status: 'closed',
        },
        {
          id: 202,
          name: '#2002',
          source_name: 'facebook',
          total_price: '200000',
          tags: 'page_HuyK - Kim Hoàn & Đá Quý, page_id_222',
          status: 'closed',
        },
      ];

      (httpService.get as jest.Mock).mockReturnValue(of({ data: { orders: customOrders } }));

      const preview = await service.getDailyRevenuePreview('2026-09-06');
      const fbEntries = preview.breakdown.fb;

      expect(fbEntries.length).toBe(2);
      const ch1 = fbEntries.find((e) => e.channel === 'HuyK - Kim Hoàn');
      const ch2 = fbEntries.find((e) => e.channel === 'HuyK - Kim Hoàn & Đá Quý');

      expect(ch1).toBeDefined();
      expect(ch1?.value).toBe('100000');
      expect(ch2).toBeDefined();
      expect(ch2?.value).toBe('200000');
    });

    it('khớp chính xác đơn TikTok Business từ referring_site với kênh TikTok kết nối thủ công', async () => {
      (prismaService.socialAccount.findMany as jest.Mock).mockResolvedValueOnce([
        {
          name: 'HuyK Official',
          username: '@huyk.trangsucchetac',
          platform: 'tiktok',
          extra_data: { link_channel: 'https://www.tiktok.com/@huyk.trangsucchetac' },
        },
      ]);

      const tiktokOrders: SapoOrder[] = [
        {
          id: 301,
          name: '#3001',
          source_name: 'tiktok-for-business',
          total_price: '650000',
          referring_site: 'https://www.tiktok.com/@huyk.trangsucchetac?is_from_webapp=1',
          status: 'closed',
        } as any,
      ];

      (httpService.get as jest.Mock).mockReturnValue(of({ data: { orders: tiktokOrders } }));

      const preview = await service.getDailyRevenuePreview('2026-09-07');
      const ttEntries = preview.breakdown.tiktok;

      expect(ttEntries.length).toBe(1);
      expect(ttEntries[0].channel).toBe('HuyK Official');
      expect(ttEntries[0].value).toBe('650000');
      expect(preview.revenue.tiktok).toBe('650000');
    });
  });

  describe('syncDailyRevenueToDatabase', () => {
    it('lưu các dòng doanh thu vào database revenue_reports', async () => {
      const res = await service.syncDailyRevenueToDatabase('2026-08-29', 'Team K1');

      expect(res.success).toBe(true);
      expect(prismaService.revenueReport.create).toHaveBeenCalled();
      expect(res.recordIds?.length).toBeGreaterThan(0);
    });
  });
});
