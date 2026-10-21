import { WorkReportService as LarkService, latestTrafficByStream } from '../src/modules/work-report/work-report.service';

describe('latestTrafficByStream — traffic = số của ngày báo cáo gần nhất trong kỳ lọc', () => {
  const row = (person: string, day: string, value: number, team = 'Team K2') => ({ person, team, day, value });
  const total = (rows: ReturnType<typeof row>[], from: string, to: string, person: string) =>
    latestTrafficByStream(rows, from, to).filter((s) => s.person === person).reduce((sum, s) => sum + s.value, 0);
  const rows = [
    row('a@x.com', '2026-10-02', 1000),
    row('a@x.com', '2026-10-02', 300),
    row('a@x.com', '2026-10-06', 2000),
    row('a@x.com', '2026-10-06', 500),
    row('a@x.com', '2026-10-12', 4000),
    row('a@x.com', '2026-10-12', 600),
  ];

  it('lọc 1 ngày lấy đúng báo cáo ngày đó (cộng các nền tảng), khoảng lấy ngày gần nhất trong khoảng', () => {
    expect(total(rows, '2026-10-06', '2026-10-06', 'a@x.com')).toBe(2500);
    expect(total(rows, '2026-10-01', '2026-10-10', 'a@x.com')).toBe(2500);
    expect(total(rows, '2026-10-01', '2026-10-31', 'a@x.com')).toBe(4600);
  });

  it('kỳ không có báo cáo vẫn trả luồng với 0 (đã báo cáo trong app, không rơi về số lark_kpi cũ)', () => {
    expect(latestTrafficByStream(rows, '2026-10-08', '2026-10-08')).toEqual([{ person: 'a@x.com', team: 'Team K2', value: 0 }]);
  });

  it('mỗi team là 1 luồng riêng, lấy ngày gần nhất của từng luồng', () => {
    const multiTeam = [
      row('a@x.com', '2026-10-03', 200),
      row('a@x.com', '2026-10-05', 300),
      row('a@x.com', '2026-10-04', 50, 'Team K5'),
      row('b@x.com', '2026-10-03', 80),
    ];
    expect(total(multiTeam, '2026-10-01', '2026-10-05', 'a@x.com')).toBe(300 + 50);
    expect(total(multiTeam, '2026-10-01', '2026-10-05', 'b@x.com')).toBe(80);
  });
});

describe('LarkService User Activity KPIs', () => {
  let service: LarkService;
  let httpMock: any;
  let configMock: any;
  let prismaMock: any;
  let cacheMock: any;

  beforeEach(() => {
    httpMock = { post: jest.fn(), get: jest.fn() };
    configMock = {
      get: jest.fn((k: string) => {
        if (k === 'LARK_APP_ID') return 'app_id';
        if (k === 'LARK_APP_SECRET') return 'app_secret';
        return null;
      }),
    };
    prismaMock = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      team: { findMany: jest.fn().mockResolvedValue([]) },
      teamMember: { findMany: jest.fn().mockResolvedValue([]) },
      editorKpi: { findMany: jest.fn().mockResolvedValue([]) },
      editorDailyKpi: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn().mockResolvedValue([]) },
      channel: { findMany: jest.fn().mockResolvedValue([]) },
      checklistReport: { findMany: jest.fn().mockResolvedValue([]) },
      trafficReport: { findMany: jest.fn().mockResolvedValue([]) },
      revenueReport: { findMany: jest.fn().mockResolvedValue([]) },
      kpi: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      reportKpi: { findMany: jest.fn().mockResolvedValue([]) },
      checklistSettings: { findFirst: jest.fn().mockResolvedValue(null) },
      role_permissions: { findMany: jest.fn().mockResolvedValue([]) },
    };
    cacheMock = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      delByPrefix: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
      invalidateDashboardMemoryCache: jest.fn(),
    };

    service = new LarkService(httpMock, configMock, prismaMock, cacheMock);
  });

  it('should initialize successfully', () => {
    expect(service).toBeDefined();
  });

  it('should invalidate activity cache properly', () => {
    service.invalidateActivityCache();
    expect(cacheMock.invalidate).toHaveBeenCalledWith('activity:');
    expect(cacheMock.invalidate).toHaveBeenCalledWith('dashboard-analytics:');
  });

  it('should resolve known identity aliases correctly', () => {
    const nameMap = new Map<string, any>();
    const emailMap = new Map<string, any>();
    nameMap.set('do dang chung', { id: 'u_chung', full_name: 'Đỗ Đăng Chung', email: 'dochung2741@gmail.com' });

    const resolved = (service as any).resolveKnownIdentityAlias(
      nameMap,
      emailMap,
      'chung do',
      'dochung2741@gmail.com',
    );
    expect(resolved).toBeDefined();
    expect(resolved.id).toBe('u_chung');
  });
});
