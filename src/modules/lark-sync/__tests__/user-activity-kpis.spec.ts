import { LarkService } from '../lark.service';

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
