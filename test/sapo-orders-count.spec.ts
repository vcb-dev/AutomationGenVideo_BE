import { SapoIntegrationService } from '../src/modules/sapo-integration/sapo-integration.service';
import { of } from 'rxjs';

describe('SapoIntegrationService - Orders Count & Date Range Statistics', () => {
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
        if (key === 'SAPO_ACCESS_TOKEN') return 'test_token';
        return null;
      }),
    };

    prismaMock = {
      team: {
        findFirst: jest.fn().mockResolvedValue({ id: 'team-uuid-1', name: 'Team K1' }),
      },
      channel: {
        findMany: jest.fn().mockResolvedValue([]),
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

  it('fetchOrdersForDateRange gọi đúng URL và query params created_on_min/max', async () => {
    const mockOrders = [
      { id: 101, order_number: 'VCB101', status: 'open', source_name: 'TikTok' },
      { id: 102, order_number: 'VCB102', status: 'completed', source_name: 'Facebook' },
    ];

    httpServiceMock.get.mockReturnValue(of({ data: { orders: mockOrders } }));

    const orders = await service.fetchOrdersForDateRange('2026-09-17', '2026-09-17');

    expect(orders).toHaveLength(2);
    expect(httpServiceMock.get).toHaveBeenCalledWith(
      expect.stringContaining('/orders.json'),
      expect.objectContaining({
        params: expect.objectContaining({
          created_on_min: '2026-09-17T00:00:00+07:00',
          created_on_max: '2026-09-17T23:59:59+07:00',
        }),
      }),
    );
  });

  it('getOrderStats bỏ qua đơn huỷ (cancelled) và tính đúng tổng số đơn hợp lệ', async () => {
    const mockOrders = [
      { id: 1, order_number: 'O1', status: 'completed', source_name: 'facebook', tags: '[Team K1]' },
      { id: 2, order_number: 'O2', status: 'cancelled', source_name: 'facebook', tags: '[Team K1]' }, // cancelled -> skip
      { id: 3, order_number: 'O3', status: 'open', source_name: 'tiktok', tags: '[Team K2]' },
    ];

    httpServiceMock.get.mockReturnValue(of({ data: { orders: mockOrders } }));

    const stats = await service.getOrderStats('2026-09-17', '2026-09-17');

    expect(stats.totalOrders).toBe(2);
    expect(stats.byPlatform.fb).toBe(1);
    expect(stats.byPlatform.tiktok).toBe(1);
    expect(stats.byTeam['Team K1']).toBe(1);
    expect(stats.byTeam['Team K2']).toBe(1);
  });

  it('getOrderStats lọc chính xác theo teamFilter khi được cung cấp', async () => {
    const mockOrders = [
      { id: 1, order_number: 'O1', status: 'completed', tags: '[Team K1]' },
      { id: 2, order_number: 'O2', status: 'completed', tags: '[Team K2]' },
      { id: 3, order_number: 'O3', status: 'open', tags: '[Team K1]' },
    ];

    httpServiceMock.get.mockReturnValue(of({ data: { orders: mockOrders } }));

    const statsK1 = await service.getOrderStats('2026-09-17', '2026-09-17', 'Team K1');
    expect(statsK1.totalOrders).toBe(2);

    const statsK2 = await service.getOrderStats('2026-09-17', '2026-09-17', 'Team K2');
    expect(statsK2.totalOrders).toBe(1);
  });

  it('getOrderStats sử dụng in-memory cache cho cùng key khoảng ngày và team', async () => {
    const mockOrders = [
      { id: 1, order_number: 'O1', status: 'completed' },
    ];

    httpServiceMock.get.mockReturnValue(of({ data: { orders: mockOrders } }));

    const stats1 = await service.getOrderStats('2026-09-18', '2026-09-18');
    const stats2 = await service.getOrderStats('2026-09-18', '2026-09-18');

    expect(stats1.totalOrders).toBe(1);
    expect(stats2.totalOrders).toBe(1);
    // Sapo API should only be called once because the second call hits the cache
    expect(httpServiceMock.get).toHaveBeenCalledTimes(1);
  });
});
