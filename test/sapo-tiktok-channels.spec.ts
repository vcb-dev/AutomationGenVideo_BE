import { SapoIntegrationService } from '../src/modules/sapo-integration/sapo-integration.service';
import { of } from 'rxjs';

describe('SapoIntegrationService - TikTok Channels Discovery & Sync', () => {
  let service: SapoIntegrationService;
  let httpServiceMock: any;
  let configServiceMock: any;
  let prismaMock: any;
  let cryptoMock: any;

  beforeEach(() => {
    httpServiceMock = {
      get: jest.fn(),
    };

    configServiceMock = {
      get: jest.fn((key: string) => {
        if (key === 'SAPO_STORE') return 'vienchibao';
        if (key === 'SAPO_API_KEY') return 'test_key';
        if (key === 'SAPO_API_SECRET') return 'test_secret';
        return null;
      }),
    };

    prismaMock = {
      team: {
        findFirst: jest.fn().mockResolvedValue({ id: 'team-uuid-1', name: 'Team HN' }),
      },
      channel: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'channel-1' }),
        update: jest.fn().mockResolvedValue({ id: 'channel-1' }),
      },
      socialAccount: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'social-1' }),
        update: jest.fn().mockResolvedValue({ id: 'social-1' }),
      },
      revenueReport: {
        create: jest.fn(),
      },
    };

    cryptoMock = {
      encrypt: jest.fn((val: string) => `enc:${val}`),
      decrypt: jest.fn((val: string) => val.replace(/^enc:/, '')),
    };

    service = new SapoIntegrationService(
      httpServiceMock,
      configServiceMock,
      prismaMock,
      cryptoMock,
    );
  });

  describe('discoverTiktokChannels', () => {
    it('trích xuất chính xác tên kênh, ID, link TikTok (referring_site) và username từ đơn hàng Sapo', async () => {
      const mockOrders = [
        {
          id: 309998010,
          source_name: 'tiktok-for-business',
          tags: 'ChatOmniAI, tiktok_business_HuyK- Xưởng Vàng Bạc 2, tiktok_business_id_-000FSBqDv2XBUeCC8xz6QDf7hfJX7DAu1t3',
          channel_definition: {
            main_name: 'Chat OmniAI',
            sub_name: 'Tiktok for Business',
            alias: 'tiktok-for-business',
            branch_name: 'HuyK- Xưởng Vàng Bạc 2',
            branch_external_id: '-000FSBqDv2XBUeCC8xz6QDf7hfJX7DAu1t3',
          },
          referring_site: 'https://www.tiktok.com/@huyk.xuongvangbac2',
          created_on: '2026-09-15T14:04:00+07:00',
        },
        {
          id: 311458730,
          source_name: 'tiktokshop',
          tags: 'Tiktok Channel, Tiktok_Viễn Chí Bảo',
          channel_definition: {
            main_name: 'Tiktokshop',
            sub_name: 'Tiktokshop',
            alias: 'tiktokshop',
            branch_name: 'Viễn Chí Bảo - Tiktokshop',
            branch_external_id: '7495245725371828263',
          },
          created_on: '2026-09-15T15:30:00+07:00',
        },
      ];

      httpServiceMock.get.mockReturnValue(of({ data: { orders: mockOrders } }));

      const channels = await service.discoverTiktokChannels(100);

      expect(channels).toHaveLength(2);

      const ttBusiness = channels.find((c) => c.type === 'TikTok Business');
      expect(ttBusiness).toBeDefined();
      expect(ttBusiness?.name).toBe('HuyK- Xưởng Vàng Bạc 2');
      expect(ttBusiness?.channelId).toBe('-000FSBqDv2XBUeCC8xz6QDf7hfJX7DAu1t3');
      expect(ttBusiness?.link_channel).toBe('https://www.tiktok.com/@huyk.xuongvangbac2');
      expect(ttBusiness?.username).toBe('@huyk.xuongvangbac2');
      expect(ttBusiness?.orderCount).toBe(1);
      expect(ttBusiness?.isImported).toBe(false);

      const ttShop = channels.find((c) => c.type === 'TikTok Shop');
      expect(ttShop).toBeDefined();
      expect(ttShop?.name).toBe('Viễn Chí Bảo');
      expect(ttShop?.channelId).toBe('7495245725371828263');
      expect(ttShop?.orderCount).toBe(1);
    });

    it('đánh dấu isImported = true nếu kênh đã tồn tại trong Channel hoặc SocialAccount', async () => {
      const mockOrders = [
        {
          id: 309998010,
          source_name: 'tiktok-for-business',
          tags: 'tiktok_business_HuyK - Trang Sức Chế Tác',
          channel_definition: {
            branch_name: 'HuyK - Trang Sức Chế Tác',
            branch_external_id: '-000aNZQ',
          },
          referring_site: 'https://www.tiktok.com/@huyk.trangsucchetac',
        },
      ];

      httpServiceMock.get.mockReturnValue(of({ data: { orders: mockOrders } }));
      prismaMock.channel.findMany.mockResolvedValue([
        { name: 'HuyK - Trang Sức Chế Tác', channel_id: '-000aNZQ', link_channel: 'https://www.tiktok.com/@huyk.trangsucchetac' },
      ]);

      const channels = await service.discoverTiktokChannels(100);
      expect(channels).toHaveLength(1);
      expect(channels[0].isImported).toBe(true);
    });
  });

  describe('syncTiktokChannels', () => {
    it('đồng bộ kênh vào cả bảng Channel và SocialAccount với đầy đủ thông tin link và id', async () => {
      const user = {
        id: 'user-uuid-1',
        team: 'Team HN',
        full_name: 'Nguyen Van A',
        roles: ['ADMIN'],
      };

      const channelsToSync = [
        {
          name: 'HuyK- Xưởng Vàng Bạc 2',
          channelId: '-000FSBqDv2XBUeCC8xz6QDf7hfJX7DAu1t3',
          link_channel: 'https://www.tiktok.com/@huyk.xuongvangbac2',
          username: '@huyk.xuongvangbac2',
          type: 'TikTok Business',
        },
      ];

      const res = await service.syncTiktokChannels(channelsToSync, user);

      expect(res.success).toBe(true);
      expect(res.count).toBe(1);
      expect(res.importedChannels).toContain('HuyK- Xưởng Vàng Bạc 2');

      // Kiểm tra prisma.channel.create
      expect(prismaMock.channel.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'HuyK- Xưởng Vàng Bạc 2',
          platform: 'tiktok',
          channel_id: '-000FSBqDv2XBUeCC8xz6QDf7hfJX7DAu1t3',
          link_channel: 'https://www.tiktok.com/@huyk.xuongvangbac2',
          owner_id: 'user-uuid-1',
          team_traffic: 'Team HN',
        }),
      });

      // Kiểm tra prisma.socialAccount.create
      expect(prismaMock.socialAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: 'user-uuid-1',
          platform: 'TIKTOK',
          platform_id: '-000FSBqDv2XBUeCC8xz6QDf7hfJX7DAu1t3',
          name: 'HuyK- Xưởng Vàng Bạc 2',
          username: 'huyk.xuongvangbac2',
          access_token_enc: 'enc:sapo_sync:-000FSBqDv2XBUeCC8xz6QDf7hfJX7DAu1t3',
          extra_data: expect.objectContaining({
            link_channel: 'https://www.tiktok.com/@huyk.xuongvangbac2',
            type: 'TikTok Business',
            source: 'sapo_orders',
          }),
        }),
      });
    });

    /**
     * Nhân sự tự thêm kênh TikTok của mình qua modal "Thêm thủ công": form chỉ hỏi tên và link,
     * không hỏi Business hay Shop. Trước đây thiếu `type` thì service ép về 'TikTok Business' và
     * gắn `source: 'sapo_orders'` — bịa ra hai thông tin sai cho báo cáo đọc phải.
     */
    it('thêm tay: không bịa loại kênh, ghi đúng nguồn là "manual"', async () => {
      const user = {
        id: 'user-uuid-2',
        team: 'Team HN',
        full_name: 'Trần Thị B',
        roles: ['MEMBER'],
      };

      await service.syncTiktokChannels(
        [
          {
            name: 'Kênh của tôi',
            channelId: 'kenh_cua_toi',
            link_channel: 'https://www.tiktok.com/@kenhcuatoi',
            username: '@kenhcuatoi',
            source: 'manual',
          },
        ],
        user,
      );

      const extra = prismaMock.socialAccount.create.mock.calls[0][0].data.extra_data;

      expect(extra.source).toBe('manual');
      expect(extra).not.toHaveProperty('type');
      expect(extra.link_channel).toBe('https://www.tiktok.com/@kenhcuatoi');
    });

    it('thêm tay: kênh thuộc về chính người thêm, không phải người khác', async () => {
      const user = {
        id: 'user-uuid-3',
        team: 'Team SG',
        full_name: 'Lê Văn C',
        roles: ['MEMBER'],
      };

      await service.syncTiktokChannels(
        [{ name: 'Kênh riêng', channelId: 'kenh_rieng', source: 'manual' }],
        user,
      );

      expect(prismaMock.channel.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ owner_id: 'user-uuid-3', owner: 'Lê Văn C' }),
      });
      expect(prismaMock.socialAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ user_id: 'user-uuid-3' }),
      });
    });
  });
});
