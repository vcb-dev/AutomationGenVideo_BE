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
    trendRows?: { created_at: Date }[];
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
      byInputType: [],
      trend: { range: '30d', points: [], periodTotal: 0, previousPeriodTotal: 0 },
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
});
