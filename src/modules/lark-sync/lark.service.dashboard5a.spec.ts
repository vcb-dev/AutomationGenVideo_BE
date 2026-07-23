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
