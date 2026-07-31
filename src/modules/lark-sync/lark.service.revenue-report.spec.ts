import { LarkService } from './lark.service';

/**
 * submitRevenueReport — báo cáo doanh thu nhập tay theo nền tảng, mirror
 * submitTrafficReport (cùng cơ chế ngày nghiệp vụ + chặn trùng), nhưng ghi
 * vào bảng revenue_reports riêng, tách biệt hoàn toàn khỏi traffic_reports.
 */
describe('LarkService.submitRevenueReport', () => {
  function build(opts: { existingRevenue?: any; userRoles?: string[] } = {}) {
    const createdRows: any[] = [];
    const prisma: any = {
      user: {
        findFirst: jest.fn(async () => ({ id: 'u1', roles: opts.userRoles || [], team: 'Test Team' })),
      },
      revenueReport: {
        findFirst: jest.fn(async () => opts.existingRevenue || null),
        createMany: jest.fn(async ({ data }: any) => { createdRows.push(...data); return { count: data.length }; }),
      },
    };
    const configService: any = { get: jest.fn(() => undefined) };
    const httpService: any = {};
    const cacheService: any = {};
    const service = new LarkService(httpService, configService, prisma, cacheService);
    // invalidateActivityCache đụng tới cache nội bộ không liên quan tới test này.
    (service as any).invalidateActivityCache = jest.fn();
    return { service, prisma, createdRows };
  }

  const basePayload = {
    email: 'member@vcb.vn',
    name: 'Nguyễn Văn A',
    team: 'Test Team',
    reportDate: '2026-07-25',
  };

  afterEach(() => jest.clearAllMocks());

  it('tạo dòng cho mọi nền tảng NGƯỜI DÙNG CÓ NHẬP, kể cả nhập số 0', async () => {
    const { service, createdRows } = build();
    const result = await service.submitRevenueReport({
      ...basePayload,
      revenueDetails: {
        breakdown: {
          tiktok: [{ value: '500000', channel: 'Kênh Tiktok A' }],
          fb: [{ value: '300000', channel: 'Kênh FB A' }],
          // Đổi hành vi có chủ ý (trước đây 0 bị bỏ qua): form ghi rõ "nếu không có hãy
          // nhập số 0", mà bỏ qua 0 thì ngày doanh thu 0 đồng không sinh dòng nào —
          // reportedRevenueTeams suy ra từ chính các dòng này nên người dùng bị tính là
          // CHƯA báo cáo dù đã bấm gửi, và bị chặn với thông báo bảo họ nhập 0.
          yt: [{ value: '0', channel: '' }],
        },
      },
    });

    expect(createdRows).toHaveLength(3);
    expect(result.recordIds).toHaveLength(3);

    const ytRow = createdRows.find((r) => r.revenue_yt !== undefined);
    expect(ytRow).toBeDefined();
    expect(Number(ytRow.revenue_yt)).toBe(0);
    expect(Number(ytRow.total_revenue)).toBe(0);

    const tiktokRow = createdRows.find((r) => r.revenue_tiktok);
    expect(Number(tiktokRow.revenue_tiktok)).toBe(500000);
    expect(Number(tiktokRow.total_revenue)).toBe(500000);
    expect(tiktokRow.channel_tiktok).toBe('Kênh Tiktok A');
    expect(tiktokRow.email).toBe('member@vcb.vn');
    expect(tiktokRow.is_confirmed).toBe('Pending');

    const fbRow = createdRows.find((r) => r.revenue_fb);
    expect(Number(fbRow.revenue_fb)).toBe(300000);
  });

  it('dùng fallback object revenue phẳng khi không có breakdown', async () => {
    const { service, createdRows } = build();
    await service.submitRevenueReport({
      ...basePayload,
      revenue: { tiktok: '750000', fb: '', ig: '', yt: '', thread: '', zalo: '' },
      channels: { tiktok: 'Kênh Tiktok B' },
    });

    expect(createdRows).toHaveLength(1);
    expect(Number(createdRows[0].revenue_tiktok)).toBe(750000);
    expect(createdRows[0].channel_tiktok).toBe('Kênh Tiktok B');
  });

  it('chặn nộp trùng cùng ngày cùng email — không tạo dòng mới', async () => {
    const { service, prisma, createdRows } = build({
      existingRevenue: { team: 'Test Team', created_at: new Date(), date: new Date() },
    });

    const result = await service.submitRevenueReport({
      ...basePayload,
      revenueDetails: { breakdown: { tiktok: [{ value: '500000', channel: 'X' }] } },
    });

    expect(result.alreadySubmitted).toBe(true);
    expect(prisma.revenueReport.createMany).not.toHaveBeenCalled();
    expect(createdRows).toHaveLength(0);
  });

  it('cho phép nộp tiếp nếu đã báo cáo team khác trong cùng ngày', async () => {
    const { service, createdRows } = build({
      existingRevenue: { team: 'Team Khác', created_at: new Date(), date: new Date() },
    });

    const result = await service.submitRevenueReport({
      ...basePayload,
      team: 'Test Team',
      revenueDetails: { breakdown: { tiktok: [{ value: '500000', channel: 'X' }] } },
    });

    expect(result.alreadySubmitted).toBeUndefined();
    expect(createdRows).toHaveLength(1);
  });

  it('chặn báo cáo ngày tương lai với user thường (không phải admin/manager)', async () => {
    const { service } = build({ userRoles: ['MEMBER'] });
    const farFuture = '2099-01-01';

    await expect(
      service.submitRevenueReport({ ...basePayload, reportDate: farFuture }),
    ).rejects.toThrow('Không thể gửi báo cáo cho ngày trong tương lai.');
  });

  it('KHÔNG chặn ngày tương lai với admin/manager', async () => {
    const { service, createdRows } = build({ userRoles: ['ADMIN'] });
    const farFuture = '2099-01-01';

    await service.submitRevenueReport({
      ...basePayload,
      reportDate: farFuture,
      revenueDetails: { breakdown: { tiktok: [{ value: '100000', channel: 'X' }] } },
    });

    expect(createdRows).toHaveLength(1);
  });
});

/**
 * Ranh giới "bỏ trống" vs "nhập số 0" — lỗi thật ngoài production: người dùng nhập 0 vào
 * các ô doanh thu rồi bấm Gửi thì bị chặn bằng đúng thông báo bảo họ nhập 0.
 * Nguyên nhân nằm ở 2 tầng, cả 2 đều phải giữ đúng ranh giới này:
 *   - FE: sumEntryValues (report-total.ts) — nhập 0 phải ra '0', không phải ''
 *   - BE: readReportedValue (lark.service.ts) — 0 phải tạo dòng, ô trống thì không
 */
describe('LarkService.submitRevenueReport — phân biệt ô để trống với số 0', () => {
  function build() {
    const createdRows: any[] = [];
    const prisma: any = {
      revenueReport: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        createMany: jest.fn(async ({ data }: any) => {
          createdRows.push(...data);
          return { count: data.length };
        }),
      },
      user: { findFirst: jest.fn(async () => null) },
    };
    const service: any = Object.create(LarkService.prototype);
    service.prisma = prisma;
    service.invalidateActivityCache = jest.fn();
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { service, createdRows };
  }

  const base = {
    email: 'member@vcb.vn',
    name: 'Nguyễn Văn A',
    team: 'Test Team',
    reportDate: '2026-07-25',
  };

  afterEach(() => jest.clearAllMocks());

  it('tất cả nền tảng đều nhập 0 → vẫn tạo dòng, để hệ thống biết là ĐÃ báo cáo', async () => {
    const { service, createdRows } = build();
    await service.submitRevenueReport({
      ...base,
      revenueDetails: {
        breakdown: {
          fb: [{ value: '0', channel: 'Kênh FB' }],
          ig: [{ value: '0', channel: 'Kênh IG' }],
        },
      },
    });

    expect(createdRows).toHaveLength(2);
    expect(createdRows.every((r) => Number(r.total_revenue) === 0)).toBe(true);
    // team phải đi kèm, vì reportedRevenueTeams được suy ra từ cột này
    expect(createdRows.every((r) => r.team === 'Test Team')).toBe(true);
  });

  it('ô để TRỐNG (chuỗi rỗng) → không tạo dòng', async () => {
    const { service, createdRows } = build();
    await service.submitRevenueReport({
      ...base,
      revenueDetails: {
        breakdown: {
          fb: [{ value: '0', channel: 'Kênh FB' }],
          ig: [{ value: '', channel: '' }],
          yt: [{ value: null, channel: '' }],
        },
      },
    });

    expect(createdRows).toHaveLength(1);
    expect(createdRows[0].revenue_fb).toBeDefined();
  });

  it('bỏ dấu phân cách người dùng gõ (1.000.000) trước khi lưu', async () => {
    const { service, createdRows } = build();
    await service.submitRevenueReport({
      ...base,
      revenueDetails: { breakdown: { fb: [{ value: '1.000.000', channel: 'Kênh FB' }] } },
    });

    expect(Number(createdRows[0].revenue_fb)).toBe(1000000);
  });

  it('nhánh fallback (object phẳng, không có breakdown) cũng nhận số 0', async () => {
    const { service, createdRows } = build();
    await service.submitRevenueReport({
      ...base,
      revenue: { fb: '0', ig: '', tiktok: '250000' },
      channels: { fb: 'Kênh FB', ig: '', tiktok: 'Kênh TikTok' },
    });

    expect(createdRows).toHaveLength(2); // fb (0) + tiktok; ig để trống nên bỏ qua
    const fbRow = createdRows.find((r) => r.revenue_fb !== undefined);
    expect(Number(fbRow.revenue_fb)).toBe(0);
  });
});
