import { IdPhotoService } from '../id-photo.service';

/**
 * Chức năng: GET /id-photo/history/team-summary — tổng quan tab "Thống kê" của Tạo ảnh thẻ
 * nhân viên (IdPhotoService#getTeamSummary + #getSoloBreakdown).
 *
 * Khoá lại 3 quyết định nghiệp vụ:
 *  1. Phạm vi quyền rỗng -> trả shape rỗng, không động tới Prisma.
 *  2. Phạm vi quyền có ĐÚNG 1 người (rất phổ biến — đa số team chỉ có 1 Leader) mới tính thêm
 *     `trend`/`positionBreakdown` (2 query thêm); phạm vi ≥ 2 người thì KHÔNG tính (đỡ chi phí
 *     cho team đông, nơi FE không dùng tới 2 field này).
 *  3. `positionBreakdown` giữ ĐÚNG thứ tự cấp bậc (không sort theo count) vì đây là dữ liệu ORDINAL.
 */
describe('IdPhotoService.getTeamSummary', () => {
  function buildService(opts: {
    members?: any[];
    grouped?: any[];
    soloTrendRows?: { created_at: Date }[];
    soloPositionGrouped?: any[];
  }) {
    const httpService: any = { post: jest.fn() };
    const configService: any = {
      get: jest.fn((key: string, def?: string) => (key === 'AI_SERVICE_URL' ? 'http://ai.test:8001' : def)),
    };
    const groupBy = jest.fn(async (args: any) => {
      if (args.by?.[0] === 'position') return opts.soloPositionGrouped ?? [];
      return opts.grouped ?? [];
    });
    const prisma: any = {
      idPhotoHistory: {
        groupBy,
        findMany: jest.fn(async () => opts.soloTrendRows ?? []),
      },
    };
    const usersService: any = { getTeamMembers: jest.fn(async () => opts.members ?? []) };
    const service = new IdPhotoService(httpService, configService, prisma, usersService);
    return { service, prisma, usersService };
  }

  it('phạm vi quyền rỗng -> trả shape rỗng, không gọi Prisma', async () => {
    const { service, prisma } = buildService({ members: [] });

    const result = await service.getTeamSummary('leader-1', ['LEADER'] as any);

    expect(result).toEqual({ members: [], totalMembers: 0, totalPhotos: 0 });
    expect(prisma.idPhotoHistory.groupBy).not.toHaveBeenCalled();
  });

  it('≥ 2 người -> tổng hợp bình thường, KHÔNG tính trend/positionBreakdown (không gọi findMany)', async () => {
    const { service, prisma } = buildService({
      members: [
        { id: 'u1', full_name: 'Bảo', email: 'bao@x.com', roles: [], team: 'T1' },
        { id: 'u2', full_name: 'An', email: 'an@x.com', roles: [], team: 'T1' },
      ],
      grouped: [
        { created_by: 'u1', _count: { _all: 3 }, _max: { created_at: new Date('2026-01-01') } },
        { created_by: 'u2', _count: { _all: 7 }, _max: { created_at: new Date('2026-01-02') } },
      ],
    });

    const result = await service.getTeamSummary('mgr-1', ['MANAGER'] as any);

    expect(result.members.map((m: any) => m.id)).toEqual(['u2', 'u1']); // 7 lượt lên trước 3 lượt
    expect(result.totalPhotos).toBe(10);
    expect((result as any).trend).toBeUndefined();
    expect((result as any).positionBreakdown).toBeUndefined();
    expect(prisma.idPhotoHistory.findMany).not.toHaveBeenCalled();
  });

  it('ĐÚNG 1 người trong phạm vi quyền -> có thêm trend (30 điểm) + positionBreakdown ĐÚNG thứ tự cấp bậc', async () => {
    const now = new Date();
    const { service } = buildService({
      members: [{ id: 'u1', full_name: 'Bảo', email: 'bao@x.com', roles: [], team: 'T1' }],
      grouped: [{ created_by: 'u1', _count: { _all: 4 }, _max: { created_at: now } }],
      soloTrendRows: [{ created_at: now }],
      soloPositionGrouped: [
        { position: 'BOD', _count: { _all: 1 } },
        { position: 'NEW_STAFF_1_3M', _count: { _all: 3 } },
      ],
    });

    const result: any = await service.getTeamSummary('leader-1', ['LEADER'] as any);

    expect(result.totalPhotos).toBe(4);
    expect(result.trend).toHaveLength(30);
    // Bản ghi "hôm nay" (now) phải rơi vào điểm CUỐI của mảng 30 ngày.
    expect(result.trend[29].count).toBe(1);
    // Giữ ĐÚNG thứ tự cấp bậc của enum (NEW_STAFF_1_3M -> ... -> BOD), không sort theo count dù
    // BOD (count=1) được mock trả về TRƯỚC NEW_STAFF_1_3M (count=3) ở groupBy.
    expect(result.positionBreakdown.map((p: any) => p.position)).toEqual([
      'NEW_STAFF_1_3M',
      'STAFF_OVER_3M',
      'LEADER',
      'MANAGER',
      'BOD',
    ]);
    expect(result.positionBreakdown.find((p: any) => p.position === 'BOD').count).toBe(1);
    expect(result.positionBreakdown.find((p: any) => p.position === 'NEW_STAFF_1_3M').count).toBe(3);
    expect(result.positionBreakdown.find((p: any) => p.position === 'LEADER').count).toBe(0);
  });
});
