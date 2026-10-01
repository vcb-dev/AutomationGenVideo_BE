import { of } from 'rxjs';
import { SapoIntegrationService } from '../src/modules/sapo-integration/sapo-integration.service';
import { SapoOrder } from '../src/modules/sapo-integration/sapo-integration.types';

// Dạng đơn lấy theo dữ liệu Sapo thật (source_name, tags, channel_definition) của cửa hàng.
const shopeeOrder = (id: number, price = '300000'): SapoOrder =>
  ({
    id,
    name: `#${id}`,
    source_name: 'shopee',
    total_price: price,
    tags: 'Shopee_Viễn Chí Bảo, Shopee Channel',
    status: 'open',
    created_on: '2026-09-30T10:00:00Z',
    channel_definition: { main_name: 'Shopee', sub_name: 'Shopee', alias: 'shopee', branch_name: 'Viễn Chí Bảo' },
  }) as any;

const zaloOrder: SapoOrder = {
  id: 2,
  name: '#2',
  source_name: 'zalo',
  total_price: '400000',
  tags: 'Zalo - Viễn Chí Bảo',
  status: 'open',
} as any;

const zaloOaOmniOrder: SapoOrder = {
  id: 3,
  name: '#3',
  source_name: 'zalo-oa',
  total_price: '500000',
  tags: 'ChatOmniAI',
  status: 'open',
  channel_definition: { main_name: 'Chat OmniAI', sub_name: 'Zalo OA', alias: 'zalo-oa' },
} as any;

const facebookPageOrder: SapoOrder = {
  id: 4,
  name: '#4',
  source_name: 'facebook',
  total_price: '1000000',
  tags: 'ChatOmniAI, page_HuyK - Kim Hoàn, page_id_2497800676910664',
  status: 'open',
  channel_definition: { main_name: 'Chat OmniAI', sub_name: 'Facebook', alias: 'facebook' },
} as any;

const tiktokBusinessOrder: SapoOrder = {
  id: 5,
  name: '#5',
  source_name: 'tiktok-for-business',
  total_price: '650000',
  tags: 'tiktok_business_HuyK- Xưởng Vàng Bạc 2',
  status: 'open',
} as any;

const posOrder: SapoOrder = {
  id: 6,
  name: '#6',
  source_name: 'pos',
  total_price: '200000',
  tags: 'Bán trực tiếp',
  status: 'closed',
} as any;

describe('SapoIntegrationService - không kéo đơn Shopee và Zalo', () => {
  let service: SapoIntegrationService;
  let httpServiceMock: { get: jest.Mock };

  beforeEach(() => {
    httpServiceMock = { get: jest.fn() };
    const configServiceMock = {
      get: jest.fn((key: string) => {
        if (key === 'SAPO_STORE') return 'vienchibao';
        if (key === 'SAPO_ACCESS_TOKEN') return 'test_token';
        return null;
      }),
    };
    const prismaMock = {
      socialAccount: { findMany: jest.fn().mockResolvedValue([]) },
      channel: { findMany: jest.fn().mockResolvedValue([]) },
      trackedChannel: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new SapoIntegrationService(httpServiceMock as any, configServiceMock as any, prismaMock as any, {} as any);
  });

  const serveSinglePage = (orders: SapoOrder[]) =>
    httpServiceMock.get.mockReturnValue(of({ data: { orders } }));

  it('isExcludedSalesChannel nhận ra đơn Shopee và Zalo (cả Zalo OA qua Chat OmniAI)', () => {
    expect(service.isExcludedSalesChannel(shopeeOrder(1))).toBe(true);
    expect(service.isExcludedSalesChannel(zaloOrder)).toBe(true);
    expect(service.isExcludedSalesChannel(zaloOaOmniOrder)).toBe(true);
  });

  it('isExcludedSalesChannel giữ nguyên đơn Facebook page, TikTok và bán trực tiếp', () => {
    expect(service.isExcludedSalesChannel(facebookPageOrder)).toBe(false);
    expect(service.isExcludedSalesChannel(tiktokBusinessOrder)).toBe(false);
    expect(service.isExcludedSalesChannel(posOrder)).toBe(false);
  });

  it('fetchOrdersForDateRange bỏ đơn Shopee/Zalo khỏi kết quả trả về', async () => {
    serveSinglePage([shopeeOrder(1), zaloOrder, zaloOaOmniOrder, facebookPageOrder, tiktokBusinessOrder, posOrder]);

    const orders = await service.fetchOrdersForDateRange('2026-09-30', '2026-09-30');

    expect(orders.map((o) => o.id)).toEqual([4, 5, 6]);
  });

  it('vẫn sang trang tiếp khi cả trang đầu toàn đơn Shopee (lọc sau khi phân trang)', async () => {
    const fullShopeePage = Array.from({ length: 250 }, (_, i) => shopeeOrder(1000 + i));
    httpServiceMock.get
      .mockReturnValueOnce(of({ data: { orders: fullShopeePage } }))
      .mockReturnValueOnce(of({ data: { orders: [facebookPageOrder] } }));

    const orders = await service.fetchOrdersForDateRange('2026-09-01', '2026-09-30');

    expect(httpServiceMock.get).toHaveBeenCalledTimes(2);
    expect(httpServiceMock.get.mock.calls[1][1].params.page).toBe(2);
    expect(orders.map((o) => o.id)).toEqual([4]);
  });

  it('getOrderStats không đếm đơn Shopee/Zalo vào tổng số đơn', async () => {
    serveSinglePage([shopeeOrder(1), zaloOrder, zaloOaOmniOrder, facebookPageOrder, tiktokBusinessOrder, posOrder]);

    const stats = await service.getOrderStats('2026-09-30', '2026-09-30');

    expect(stats.totalOrders).toBe(3);
    expect(stats.byPlatform.zalo).toBe(0);
    expect(stats.byPlatform.fb).toBe(1);
    expect(stats.byPlatform.tiktok).toBe(1);
    expect(stats.byPlatform.other).toBe(1); // chỉ còn đơn bán trực tiếp, không còn Shopee
  });

  it('getDailyRevenuePreview không điền doanh thu Zalo và không cộng Shopee vào tổng', async () => {
    serveSinglePage([shopeeOrder(1), zaloOrder, zaloOaOmniOrder, facebookPageOrder, tiktokBusinessOrder, posOrder]);

    const preview = await service.getDailyRevenuePreview('2026-09-30');

    expect(preview.revenue.zalo).toBe('');
    expect(preview.breakdown.zalo).toEqual([expect.objectContaining({ value: '', channel: '' })]);
    expect(preview.orderCount).toBe(3);
    expect(preview.totalRevenue).toBe(String(1000000 + 650000 + 200000));
    expect(preview.unassignedRevenue).toBe('200000'); // chỉ đơn bán trực tiếp
  });
});
