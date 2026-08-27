import { AiIntegrationService } from '../ai-integration.service';

/**
 * Chức năng: GET /ai/content-transform/history/team-summary — tổng quan tab "Thống kê" của
 * Chuyển đổi nội dung (AiIntegrationService#getContentTransformTeamSummary).
 *
 * Khoá lại 3 quyết định nghiệp vụ:
 *  1. Không có thành viên nào trong phạm vi quyền -> trả shape rỗng, KHÔNG động tới Prisma (đỡ
 *     3 query vô nghĩa khi memberIds rỗng).
 *  2. Xếp hạng: nhiều lượt nhất lên trước, hoà số lượt thì xếp theo tên (tie-break ổn định).
 *  3. Bucket xu hướng theo NGÀY UTC: bản ghi trong `range` hiện tại lên `points` + cộng
 *     `periodTotal`; bản ghi thuộc kỳ liền trước KHÔNG lên `points`, chỉ cộng `previousPeriodTotal`
 *     (dùng để FE tính badge % thay đổi).
 */
describe('AiIntegrationService.getContentTransformTeamSummary', () => {
  function buildService(opts: {
    members?: any[];
    groupedByUser?: any[];
    groupedByInputType?: any[];
    trendRows?: { created_at: Date; cost_usd?: number | null }[];
  }) {
    const httpService: any = { post: jest.fn() };
    const configService: any = {
      get: jest.fn((key: string, def?: string) => (key === 'AI_SERVICE_URL' ? 'http://ai.test:8001' : def)),
    };
    const jwtService: any = { sign: jest.fn() };
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce(opts.groupedByUser ?? [])
      .mockResolvedValueOnce(opts.groupedByInputType ?? []);
    const prisma: any = {
      contentTransformHistory: {
        groupBy,
        findMany: jest.fn(async () => opts.trendRows ?? []),
      },
    };
    const usersService: any = { getTeamMembers: jest.fn(async () => opts.members ?? []) };
    const service = new AiIntegrationService(httpService, configService, jwtService, prisma, {} as any, usersService);
    return { service, prisma, usersService };
  }

  it('phạm vi quyền rỗng -> trả shape rỗng, không gọi Prisma', async () => {
    const { service, prisma } = buildService({ members: [] });

    const result = await service.getContentTransformTeamSummary('leader-1', ['LEADER'] as any, '30d');

    expect(result).toEqual({
      members: [],
      totalMembers: 0,
      totalTransforms: 0,
      totalCostUsd: 0,
      byInputType: [],
      trend: { range: '30d', points: [], periodTotal: 0, previousPeriodTotal: 0, periodCostUsd: 0, previousPeriodCostUsd: 0 },
    });
    expect(prisma.contentTransformHistory.groupBy).not.toHaveBeenCalled();
  });

  it('xếp giảm dần theo totalTransforms, hoà số lượt thì xếp theo tên', async () => {
    const { service } = buildService({
      members: [
        { id: 'u1', full_name: 'Bảo', email: 'bao@x.com', roles: [], team: 'T1' },
        { id: 'u2', full_name: 'An', email: 'an@x.com', roles: [], team: 'T1' },
        { id: 'u3', full_name: 'Chi', email: 'chi@x.com', roles: [], team: 'T1' },
      ],
      groupedByUser: [
        { user_id: 'u1', _count: { _all: 5 }, _max: { created_at: new Date('2026-01-01') } },
        { user_id: 'u2', _count: { _all: 5 }, _max: { created_at: new Date('2026-01-02') } },
        { user_id: 'u3', _count: { _all: 9 }, _max: { created_at: new Date('2026-01-03') } },
      ],
    });

    const result = await service.getContentTransformTeamSummary('mgr-1', ['MANAGER'] as any);

    expect(result.members.map((m: any) => m.id)).toEqual(['u3', 'u2', 'u1']); // u2 trước u1 vì "An" < "Bảo"
    expect(result.totalTransforms).toBe(19);
    expect(result.totalMembers).toBe(3);
  });

  it('bucket theo range hiện tại lên points + periodTotal; bản ghi kỳ trước chỉ cộng previousPeriodTotal, không lên points', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-24T12:00:00.000Z'));
    try {
      // range=7d: rangeEnd=2026-08-25T00:00Z, rangeStart=2026-08-18T00:00Z, previousRangeStart=2026-08-11T00:00Z
      const { service } = buildService({
        members: [{ id: 'u1', full_name: 'Bảo', email: 'bao@x.com', roles: [], team: 'T1' }],
        groupedByUser: [{ user_id: 'u1', _count: { _all: 2 }, _max: { created_at: new Date('2026-08-20') } }],
        trendRows: [
          { created_at: new Date('2026-08-20T03:00:00.000Z') }, // trong range hiện tại
          { created_at: new Date('2026-08-15T03:00:00.000Z') }, // kỳ liền trước
        ],
      });

      const result = await service.getContentTransformTeamSummary('leader-1', ['LEADER'] as any, '7d');

      expect(result.trend.periodTotal).toBe(1);
      expect(result.trend.previousPeriodTotal).toBe(1);
      expect(result.trend.points).toHaveLength(7);
      const point = result.trend.points.find((p: any) => p.date === '2026-08-20');
      expect(point?.count).toBe(1);
      // Ngày của bản ghi kỳ trước không nằm trong 7 điểm của range hiện tại.
      expect(result.trend.points.find((p: any) => p.date === '2026-08-15')).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('range=custom: dùng đúng from/to do FE gửi lên thay vì 7d/30d/90d cố định', async () => {
    const { service } = buildService({
      members: [{ id: 'u1', full_name: 'Bảo', email: 'bao@x.com', roles: [], team: 'T1' }],
      groupedByUser: [{ user_id: 'u1', _count: { _all: 1 }, _max: { created_at: new Date('2026-08-10') } }],
      trendRows: [
        { created_at: new Date('2026-08-10T03:00:00.000Z') }, // trong khoảng 08-05 -> 08-15
        { created_at: new Date('2026-07-20T03:00:00.000Z') }, // trước khoảng -> chỉ cộng previousPeriodTotal
      ],
    });

    const result = await service.getContentTransformTeamSummary(
      'leader-1',
      ['LEADER'] as any,
      'custom',
      '2026-08-05',
      '2026-08-15',
    );

    expect(result.trend.range).toBe('custom');
    expect(result.trend.from).toBe('2026-08-05');
    expect(result.trend.to).toBe('2026-08-15');
    expect(result.trend.points).toHaveLength(11); // 05..15 gồm cả 2 đầu
    expect(result.trend.points.find((p: any) => p.date === '2026-08-10')?.count).toBe(1);
    expect(result.trend.periodTotal).toBe(1);
    expect(result.trend.previousPeriodTotal).toBe(1);
  });

  it('range=custom: from/to bị đảo ngược (to trước from) -> tự hoán đổi thay vì lỗi', async () => {
    const { service } = buildService({
      members: [{ id: 'u1', full_name: 'Bảo', email: 'bao@x.com', roles: [], team: 'T1' }],
      groupedByUser: [{ user_id: 'u1', _count: { _all: 1 }, _max: { created_at: new Date('2026-08-10') } }],
      trendRows: [{ created_at: new Date('2026-08-10T03:00:00.000Z') }],
    });

    const result = await service.getContentTransformTeamSummary(
      'leader-1',
      ['LEADER'] as any,
      'custom',
      '2026-08-15', // from > to
      '2026-08-05',
    );

    expect(result.trend.from).toBe('2026-08-05');
    expect(result.trend.to).toBe('2026-08-15');
  });

  // ── Chi phí AI — cùng dữ liệu groupBy/trendRows đã có sẵn, chỉ thêm cost_usd ──────────────
  it('costUsd từng thành viên lấy từ _sum.cost_usd (all-time, cùng phạm vi với totalTransforms)', async () => {
    const { service } = buildService({
      members: [
        { id: 'u1', full_name: 'Bảo', email: 'bao@x.com', roles: [], team: 'T1' },
        { id: 'u2', full_name: 'An', email: 'an@x.com', roles: [], team: 'T1' },
      ],
      groupedByUser: [
        { user_id: 'u1', _count: { _all: 3 }, _max: { created_at: new Date('2026-08-01') }, _sum: { cost_usd: 1.5 } },
        // Chưa có bản ghi nào tính được cost (tạo trước migration) -> Prisma trả _sum null, KHÔNG
        // phải lỗi, phải rơi về 0 chứ không throw hay để undefined lọt ra response.
        { user_id: 'u2', _count: { _all: 1 }, _max: { created_at: new Date('2026-08-02') }, _sum: { cost_usd: null } },
      ],
    });

    const result = await service.getContentTransformTeamSummary('mgr-1', ['MANAGER'] as any);

    const u1 = result.members.find((m: any) => m.id === 'u1');
    const u2 = result.members.find((m: any) => m.id === 'u2');
    expect(u1.costUsd).toBe(1.5);
    expect(u2.costUsd).toBe(0);
    expect(result.totalCostUsd).toBe(1.5);
  });

  it('trend.periodCostUsd/previousPeriodCostUsd tách theo đúng kỳ, cùng luật với periodTotal', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-24T12:00:00.000Z'));
    try {
      const { service } = buildService({
        members: [{ id: 'u1', full_name: 'Bảo', email: 'bao@x.com', roles: [], team: 'T1' }],
        groupedByUser: [
          { user_id: 'u1', _count: { _all: 2 }, _max: { created_at: new Date('2026-08-20') }, _sum: { cost_usd: 0.6 } },
        ],
        trendRows: [
          { created_at: new Date('2026-08-20T03:00:00.000Z'), cost_usd: 0.4 }, // kỳ hiện tại (7d)
          { created_at: new Date('2026-08-15T03:00:00.000Z'), cost_usd: 0.2 }, // kỳ liền trước
        ],
      });

      const result = await service.getContentTransformTeamSummary('leader-1', ['LEADER'] as any, '7d');

      expect(result.trend.periodCostUsd).toBeCloseTo(0.4);
      expect(result.trend.previousPeriodCostUsd).toBeCloseTo(0.2);
    } finally {
      jest.useRealTimers();
    }
  });
});
