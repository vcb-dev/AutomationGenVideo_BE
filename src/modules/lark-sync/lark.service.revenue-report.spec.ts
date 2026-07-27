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

  it('tạo đúng số dòng theo breakdown, mỗi dòng 1 nền tảng có giá trị > 0', async () => {
    const { service, createdRows } = build();
    const result = await service.submitRevenueReport({
      ...basePayload,
      revenueDetails: {
        breakdown: {
          tiktok: [{ value: '500000', channel: 'Kênh Tiktok A' }],
          fb: [{ value: '300000', channel: 'Kênh FB A' }],
          yt: [{ value: '0', channel: '' }], // giá trị 0 không được tạo dòng
        },
      },
    });

    expect(createdRows).toHaveLength(2);
    expect(result.recordIds).toHaveLength(2);

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
