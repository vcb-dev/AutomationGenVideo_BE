import { LarkService } from './lark.service';

/**
 * getDashboard5AForTeams — gộp dashboard 5A cho leader lead CÙNG LÚC nhiều team (có thật trên DB:
 * 1 leader lead cả "Scale Data" + "Team K1" + "MEDIA"). Bug gốc: lark.controller.ts từng dùng
 * `team.findFirst` nên chỉ trả 1/N team của leader — hàm này là phần gộp kết quả sau khi controller
 * đã sửa sang `findMany`. Test bằng cách mock thẳng `getDashboard5A` (đã có test coverage riêng qua
 * việc nó tái dùng getDashboardAnalytics đã chạy production từ trước) để cô lập đúng logic MERGE.
 */
describe('LarkService.getDashboard5AForTeams', () => {
  function build() {
    const httpService: any = {};
    const configService: any = { get: jest.fn(() => undefined) };
    const prisma: any = {};
    const cacheService: any = {};
    const service = new LarkService(httpService, configService, prisma, cacheService);
    return service;
  }

  afterEach(() => jest.restoreAllMocks());

  it('KHÔNG gọi getDashboard5A({team: undefined}) khi teamNames rỗng — tránh lộ dữ liệu toàn công ty cho người không thuộc team nào', async () => {
    const service = build();
    const spy = jest.spyOn(service, 'getDashboard5A');

    const result = await service.getDashboard5AForTeams({}, []);

    expect(spy).not.toHaveBeenCalled();
    expect(result).toEqual({
      kpi: null,
      teams: [],
      channels: [],
      a5: { available: false, note: 'Không có team nào để hiển thị.' },
    });
  });

  it('1 team: gọi thẳng getDashboard5A, không gộp gì thêm', async () => {
    const service = build();
    const fakeResult = { kpi: { totalVideos: 10 }, teams: [{ name: 'Team K1' }], channels: [], a5: { available: false, note: 'x' } };
    const spy = jest.spyOn(service, 'getDashboard5A').mockResolvedValue(fakeResult as any);

    const result = await service.getDashboard5AForTeams({ startDate: '2026-07-01' }, ['Team K1']);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ startDate: '2026-07-01', team: 'Team K1' });
    expect(result).toBe(fakeResult);
  });

  it('nhiều team (leader lead 3 team): cộng dồn video/traffic/doanh thu/chỉ tiêu, tính lại progressPct, lấy lastSyncedAt mới nhất', async () => {
    const service = build();
    const perTeam: Record<string, any> = {
      'Scale Data': {
        kpi: { totalVideos: 5, prevVideos: 1, totalTraffic: 100, totalRevenue: 0, totalKpiTarget: 10, progressPct: 50, lastSyncedAt: new Date('2026-06-20T00:00:00Z') },
        teams: [{ name: 'Scale Data', staffCount: 3 }],
        channels: [{ id: 'c1' }],
        a5: { available: false, note: 'note' },
      },
      'Team K1': {
        kpi: { totalVideos: 15, prevVideos: 2, totalTraffic: 0, totalRevenue: 200, totalKpiTarget: 20, progressPct: 75, lastSyncedAt: new Date('2026-07-05T05:00:00Z') },
        teams: [{ name: 'Team K1', staffCount: 5 }],
        channels: [],
        a5: { available: false, note: 'note' },
      },
      MEDIA: {
        kpi: { totalVideos: 0, prevVideos: 0, totalTraffic: 0, totalRevenue: 0, totalKpiTarget: 0, progressPct: null, lastSyncedAt: null },
        teams: [{ name: 'MEDIA', staffCount: 7 }],
        channels: [{ id: 'c2' }, { id: 'c3' }],
        a5: { available: false, note: 'note' },
      },
    };
    jest.spyOn(service, 'getDashboard5A').mockImplementation(async ({ team }: any) => perTeam[team as string]);

    const result = await service.getDashboard5AForTeams({}, ['Scale Data', 'Team K1', 'MEDIA']);

    expect(result.kpi).toEqual({
      totalVideos: 20, // 5 + 15 + 0
      prevVideos: 3, // 1 + 2 + 0
      totalTraffic: 100, // 100 + 0 + 0
      totalRevenue: 200, // 0 + 200 + 0
      totalKpiTarget: 30, // 10 + 20 + 0
      progressPct: 67, // round(20/30*100)
      lastSyncedAt: new Date('2026-07-05T05:00:00Z'), // mới nhất trong 3 team, KHÔNG phải team đầu tiên
    });
    expect(result.teams.map((t: any) => t.name)).toEqual(['Scale Data', 'Team K1', 'MEDIA']);
    expect(result.channels).toHaveLength(3); // 1 + 0 + 2
  });

  it('progressPct = null khi tổng chỉ tiêu = 0 (tránh chia cho 0)', async () => {
    const service = build();
    jest.spyOn(service, 'getDashboard5A').mockResolvedValue({
      kpi: { totalVideos: 0, prevVideos: 0, totalTraffic: 0, totalRevenue: 0, totalKpiTarget: 0, progressPct: null, lastSyncedAt: null },
      teams: [],
      channels: [],
      a5: { available: false, note: 'note' },
    } as any);

    const result = await service.getDashboard5AForTeams({}, ['A', 'B']);

    expect(result.kpi.totalKpiTarget).toBe(0);
    expect(result.kpi.progressPct).toBeNull();
  });
});

/**
 * _buildDashboardAnalytics (dùng chung bởi getDashboardAnalytics + getDashboard5A) — Tổng
 * Traffic/Doanh Thu trên trang admin từng lấy từ `kpi.traffic_month`/`revenue_month` (job sync
 * Lark ngoài) nên hay hiện "Chưa có dữ liệu" vì phần lớn team không được job đó điền, và job đã
 * tạm dừng từ 2026-07-11 (xem AdminOverviewFiltersContext.tsx phía FE). Sửa: traffic/doanh thu
 * giờ tính từ dữ liệu TỰ BÁO CÁO hàng ngày (trafficReport.total_traffic + đáp án doanh thu trong
 * checklistReport.answers), độc lập với job sync Lark. Test qua `getDashboardAnalytics` (entry
 * point public) với cacheService mock bỏ qua cache để gọi thẳng logic bên trong.
 */
describe('LarkService._buildDashboardAnalytics — traffic/doanh thu tự báo cáo', () => {
  function buildWithPrisma(prismaOverrides: {
    users?: any[];
    kpis?: any[];
    trafficReports?: any[];
    checklistReports?: any[];
  }) {
    const prisma: any = {
      reportedTask: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      kpi: { findMany: jest.fn().mockResolvedValue(prismaOverrides.kpis ?? []) },
      user: { findMany: jest.fn().mockResolvedValue(prismaOverrides.users ?? []) },
      channel: { findMany: jest.fn().mockResolvedValue([]) },
      trafficReport: { findMany: jest.fn().mockResolvedValue(prismaOverrides.trafficReports ?? []) },
      checklistReport: { findMany: jest.fn().mockResolvedValue(prismaOverrides.checklistReports ?? []) },
    };
    const httpService: any = {};
    const configService: any = { get: jest.fn(() => undefined) };
    // Bỏ qua cache: gọi thẳng factory để test logic tính toán, không phải cơ chế cache.
    const cacheService: any = { get: jest.fn((_key: string, _ttl: number, fn: () => any) => fn()) };
    const service = new LarkService(httpService, configService, prisma, cacheService);
    return service;
  }

  const REVENUE_KEY = 'Bạn đã đạt doanh thu của bao nhiêu video?';

  afterEach(() => jest.restoreAllMocks());

  it('lấy traffic/doanh thu từ tự báo cáo, KHÔNG dùng kpi.traffic_month/revenue_month (dù kpi có giá trị)', async () => {
    const service = buildWithPrisma({
      users: [
        { email: 'alice@x.com', full_name: 'Alice A', team: 'Team K1', roles: [], _count: { tracked_channels: 0 } },
      ],
      // kpi.traffic_month/revenue_month cố tình để giá trị rất lớn — nếu code còn dùng nguồn này,
      // assertion bên dưới sẽ fail vì tổng sẽ ra 999999999 thay vì số tự báo cáo nhỏ hơn nhiều.
      kpis: [
        {
          name: 'Alice A', team: 'Team K1', month: 'T7', report_date: new Date('2026-07-15T05:00:00Z'),
          state: null, kpi_day: 0, kpi_month: 50, completed_day: 0, completed_month: 5,
          traffic_month: 999999999, revenue_month: 888888888,
        },
      ],
      trafficReports: [
        { email: 'alice@x.com', name: 'Alice A', team: 'Team K1', total_traffic: 12345 },
      ],
      checklistReports: [
        { email: 'alice@x.com', name: 'Alice A', team: 'Team K1', answers: { [REVENUE_KEY]: 7777 } },
      ],
    });

    const result = await service.getDashboardAnalytics({ startDate: '2026-07-01', endDate: '2026-07-31' });

    expect(result.summary.totalTraffic).toBe(12345);
    expect(result.summary.totalRevenue).toBe(7777);
    expect(result.summary.totalVideos).toBe(5); // completed_month vẫn từ kpi — không đổi
  });

  it('người CHỈ có tự báo cáo (không có dòng kpi/task nào trong kỳ) vẫn được cộng vào tổng', async () => {
    const service = buildWithPrisma({
      users: [
        { email: 'bob@x.com', full_name: 'Bob B', team: 'Team K2', roles: [], _count: { tracked_channels: 0 } },
      ],
      kpis: [], // job sync Lark không có dòng nào cho Bob (đã dừng từ 2026-07-11)
      trafficReports: [
        { email: 'bob@x.com', name: 'Bob B', team: 'Team K2', total_traffic: 500 },
      ],
      checklistReports: [],
    });

    const result = await service.getDashboardAnalytics({ startDate: '2026-07-01', endDate: '2026-07-31' });

    expect(result.summary.totalTraffic).toBe(500);
    expect(result.summary.totalRevenue).toBe(0);
  });

  it('lọc theo team: người tự báo cáo KHÁC team đang lọc không được cộng vào tổng', async () => {
    const service = buildWithPrisma({
      users: [
        { email: 'alice@x.com', full_name: 'Alice A', team: 'Team K1', roles: [], _count: { tracked_channels: 0 } },
        { email: 'bob@x.com', full_name: 'Bob B', team: 'Team K2', roles: [], _count: { tracked_channels: 0 } },
      ],
      kpis: [],
      trafficReports: [
        { email: 'alice@x.com', name: 'Alice A', team: 'Team K1', total_traffic: 111 },
        { email: 'bob@x.com', name: 'Bob B', team: 'Team K2', total_traffic: 999 },
      ],
      checklistReports: [],
    });

    const result = await service.getDashboardAnalytics({
      startDate: '2026-07-01', endDate: '2026-07-31', team: 'Team K1',
    });

    expect(result.summary.totalTraffic).toBe(111); // Bob (Team K2) bị loại khỏi tổng
  });

  it('đáp án doanh thu null/rỗng trong checklist không cộng dồn thành NaN hay lỗi', async () => {
    const service = buildWithPrisma({
      users: [
        { email: 'alice@x.com', full_name: 'Alice A', team: 'Team K1', roles: [], _count: { tracked_channels: 0 } },
      ],
      kpis: [],
      trafficReports: [],
      checklistReports: [
        { email: 'alice@x.com', name: 'Alice A', team: 'Team K1', answers: { [REVENUE_KEY]: null } },
      ],
    });

    const result = await service.getDashboardAnalytics({ startDate: '2026-07-01', endDate: '2026-07-31' });

    expect(result.summary.totalRevenue).toBe(0);
    expect(Number.isNaN(result.summary.totalRevenue)).toBe(false);
  });
});
