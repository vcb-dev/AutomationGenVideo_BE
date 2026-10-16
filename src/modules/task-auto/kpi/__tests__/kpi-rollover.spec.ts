import {
  KpiRolloverService,
  isEmptyEditorKpi,
  planKpiRollover,
  previousMonthKey,
  rolloverKey,
} from '../kpi-rollover.service';

const ZERO_TARGETS = {
  total_target: 0, video_win: 0, video_fail: 0, kpi_extra: 0, content_new: 0,
  content_paast_analyzed: 0, content_win_cover: 0, product_gmv: 0, product_traffic: 0,
  product_profit: 0, product_collect_test_win: 0,
};

function editorKpi(id: string, userId: string, teamId: string | null, targets: Partial<typeof ZERO_TARGETS> = {}, allocations: any[] = []) {
  return { id, user_id: userId, team_id: teamId, set_by_id: 'leader-1', ...ZERO_TARGETS, ...targets, allocations };
}

const A4_ALLOC = { type: 'CONTENT_LINE', content_line_id: 'cl-a4', product_line_id: null, quantity: 30 };
const A1_ALLOC = { type: 'CONTENT_LINE', content_line_id: 'cl-a1', product_line_id: null, quantity: 10 };
const GMV_ALLOC = { type: 'PRODUCT_LINE', content_line_id: null, product_line_id: 'pl-gmv', quantity: 5 };

describe('planKpiRollover — chọn dòng KPI cần chép', () => {
  const isEmpty = (r: any) => isEmptyEditorKpi(r);

  it('tháng mới chưa có dòng → tạo; có dòng toàn 0 → điền đè; đã có chỉ tiêu → giữ nguyên', () => {
    const sources = [
      editorKpi('s1', 'u1', 't1', { total_target: 40 }),
      editorKpi('s2', 'u2', 't1', { total_target: 20 }),
      editorKpi('s3', 'u3', 't1', { total_target: 20 }),
    ];
    const targets = [
      editorKpi('n2', 'u2', 't1'), // dòng seed lúc thêm vào team
      editorKpi('n3', 'u3', 't1', { total_target: 25 }), // leader đặt trước cho tháng mới
    ];
    const inTeam = new Set(['u1', 'u2', 'u3'].map((u) => rolloverKey(u, 't1')));

    const plan = planKpiRollover(sources, targets, inTeam, isEmpty);

    expect(plan.create.map((r) => r.id)).toEqual(['s1']);
    expect(plan.fill).toEqual([{ source: sources[1], targetId: 'n2' }]);
  });

  it('bỏ qua dòng tháng trước toàn 0, dòng legacy không team, và người đã rời team', () => {
    const sources = [
      editorKpi('s1', 'u1', 't1'),
      editorKpi('s2', 'u2', null, { total_target: 20 }),
      editorKpi('s3', 'u3', 't1', { total_target: 20 }),
    ];
    const inTeam = new Set([rolloverKey('u1', 't1'), rolloverKey('u2', 't1')]);

    const plan = planKpiRollover(sources, [], inTeam, isEmpty);

    expect(plan.create).toEqual([]);
    expect(plan.fill).toEqual([]);
  });

  it('cùng người 2 team: xét riêng từng team', () => {
    const sources = [
      editorKpi('s1', 'u1', 't1', { total_target: 40 }),
      editorKpi('s2', 'u1', 't2', { total_target: 10 }),
    ];
    const targets = [editorKpi('n1', 'u1', 't1', { total_target: 35 })];
    const inTeam = new Set([rolloverKey('u1', 't1'), rolloverKey('u1', 't2')]);

    expect(planKpiRollover(sources, targets, inTeam, isEmpty).create.map((r) => r.id)).toEqual(['s2']);
  });

  it('chỉ có phân bổ > 0 (các cột tổng = 0) vẫn tính là đã đặt KPI', () => {
    expect(isEmptyEditorKpi(editorKpi('k', 'u', 't', {}, [A4_ALLOC]))).toBe(false);
    expect(isEmptyEditorKpi(editorKpi('k', 'u', 't', {}, [{ ...A4_ALLOC, quantity: 0 }]))).toBe(true);
  });
});

describe('previousMonthKey', () => {
  it('lùi 1 tháng, qua năm', () => {
    expect(previousMonthKey('2026-11')).toBe('2026-10');
    expect(previousMonthKey('2027-01')).toBe('2026-12');
  });
});

describe('KpiRolloverService.ensureMonthRollover', () => {
  function build(opts: {
    marker?: any;
    editorKpis?: Record<string, any[]>; // theo month
    creatorKpis?: Record<string, any[]>;
    activeUserIds?: string[];
    members?: { user_id: string; team_id: string }[];
    ledTeams?: { id: string; leader_id: string }[];
    txError?: any;
  } = {}) {
    const byMonth = (rows: Record<string, any[]> | undefined) =>
      jest.fn(async (args: any) => rows?.[args.where.month] ?? []);
    const tx: any = {
      kpiMonthRollover: {
        create: jest.fn(async (args: any) => args.data),
        update: jest.fn(async (args: any) => args.data),
      },
      editorKpi: {
        findMany: byMonth(opts.editorKpis),
        createMany: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
      editorKpiAllocation: {
        createMany: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({})),
      },
      contentCreatorKpi: {
        findMany: byMonth(opts.creatorKpis),
        createMany: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
      user: {
        findMany: jest.fn(async () => (opts.activeUserIds ?? ['u1', 'u2', 'u3', 'leader-1']).map((id) => ({ id }))),
      },
      teamMember: { findMany: jest.fn(async () => opts.members ?? []) },
      team: { findMany: jest.fn(async () => opts.ledTeams ?? []) },
    };
    const prisma: any = {
      kpiMonthRollover: { findUnique: jest.fn(async () => opts.marker ?? null) },
      $transaction: jest.fn(async (fn: any) => {
        if (opts.txError) throw opts.txError;
        return fn(tx);
      }),
    };
    return { service: new KpiRolloverService(prisma), prisma, tx };
  }

  it('tháng đã có mốc → không chép, trả null', async () => {
    const { service, prisma } = build({ marker: { month: '2026-11' } });

    expect(await service.ensureMonthRollover('2026-11', 'CRON')).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('chép KPI editor kèm phân bổ tuyến/dòng SP sang tháng mới, giữ người đặt gốc', async () => {
    const { service, tx } = build({
      editorKpis: {
        '2026-10': [editorKpi('s1', 'u1', 't1', { total_target: 40, product_gmv: 5, content_new: 3 }, [A4_ALLOC, A1_ALLOC, GMV_ALLOC])],
      },
      members: [{ user_id: 'u1', team_id: 't1' }],
    });

    const result = await service.ensureMonthRollover('2026-11', 'AUTO_ASSIGN');

    expect(result).toEqual({ month: '2026-11', source_month: '2026-10', editor_kpis_copied: 1, creator_kpis_copied: 0 });
    const created = tx.editorKpi.createMany.mock.calls[0][0].data;
    expect(created).toEqual([
      expect.objectContaining({
        user_id: 'u1', team_id: 't1', month: '2026-11', set_by_id: 'leader-1',
        total_target: 40, product_gmv: 5, content_new: 3, video_win: 0,
      }),
    ]);
    const newId = created[0].id;
    expect(newId).toEqual(expect.any(String));
    expect(tx.editorKpiAllocation.createMany.mock.calls[0][0].data).toEqual([
      { editor_kpi_id: newId, ...A4_ALLOC },
      { editor_kpi_id: newId, ...A1_ALLOC },
      { editor_kpi_id: newId, ...GMV_ALLOC },
    ]);
    // Mốc ghi trước khi chép, rồi cập nhật số dòng đã chép
    expect(tx.kpiMonthRollover.create).toHaveBeenCalledWith({
      data: { month: '2026-11', source_month: '2026-10', trigger: 'AUTO_ASSIGN' },
    });
    expect(tx.kpiMonthRollover.create.mock.invocationCallOrder[0])
      .toBeLessThan(tx.editorKpi.createMany.mock.invocationCallOrder[0]);
    expect(tx.kpiMonthRollover.update).toHaveBeenCalledWith({
      where: { month: '2026-11' }, data: { editor_kpis_copied: 1, creator_kpis_copied: 0 },
    });
  });

  it('dòng tháng mới toàn 0 (seed) → điền chỉ tiêu + thay phân bổ, không tạo dòng trùng', async () => {
    const { service, tx } = build({
      editorKpis: {
        '2026-10': [editorKpi('s1', 'u1', 't1', { total_target: 30 }, [A4_ALLOC])],
        '2026-11': [editorKpi('n1', 'u1', 't1')],
      },
      members: [{ user_id: 'u1', team_id: 't1' }],
    });

    await service.ensureMonthRollover('2026-11', 'CRON');

    expect(tx.editorKpi.createMany).not.toHaveBeenCalled();
    expect(tx.editorKpi.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: expect.objectContaining({ total_target: 30, set_by_id: 'leader-1' }),
    });
    expect(tx.editorKpiAllocation.deleteMany).toHaveBeenCalledWith({ where: { editor_kpi_id: { in: ['n1'] } } });
    expect(tx.editorKpiAllocation.createMany.mock.calls[0][0].data).toEqual([{ editor_kpi_id: 'n1', ...A4_ALLOC }]);
  });

  it('leader không có dòng team_members vẫn được chép KPI của mình; user đã khoá/xoá thì bỏ', async () => {
    const { service, tx } = build({
      editorKpis: {
        '2026-10': [
          editorKpi('s1', 'leader-1', 't1', { total_target: 10 }),
          editorKpi('s2', 'u2', 't1', { total_target: 20 }),
        ],
      },
      activeUserIds: ['leader-1'],
      members: [{ user_id: 'u2', team_id: 't1' }],
      ledTeams: [{ id: 't1', leader_id: 'leader-1' }],
    });

    const result = await service.ensureMonthRollover('2026-11', 'CRON');

    expect(result?.editor_kpis_copied).toBe(1);
    expect(tx.editorKpi.createMany.mock.calls[0][0].data.map((r: any) => r.user_id)).toEqual(['leader-1']);
    expect(tx.teamMember.findMany.mock.calls[0][0].where.team).toEqual({ is_active: true });
    expect(tx.team.findMany.mock.calls[0][0].where.is_active).toBe(true);
  });

  it('chép KPI content creator (không chép ghi chú), dòng toàn 0 ở tháng mới thì điền đè', async () => {
    const creator = (id: string, userId: string, content: number, translation: number) => ({
      id, user_id: userId, team_id: 't1', set_by_id: 'leader-1', content_target: content, translation_target: translation,
    });
    const { service, tx } = build({
      creatorKpis: {
        '2026-10': [creator('c1', 'u1', 60, 10), creator('c2', 'u2', 30, 0), creator('c3', 'u3', 0, 0)],
        '2026-11': [creator('n2', 'u2', 0, 0)],
      },
      members: ['u1', 'u2', 'u3'].map((u) => ({ user_id: u, team_id: 't1' })),
    });

    const result = await service.ensureMonthRollover('2026-11', 'CRON');

    expect(result?.creator_kpis_copied).toBe(2);
    expect(tx.contentCreatorKpi.createMany.mock.calls[0][0].data).toEqual([
      { user_id: 'u1', team_id: 't1', month: '2026-11', content_target: 60, translation_target: 10, set_by_id: 'leader-1' },
    ]);
    expect(tx.contentCreatorKpi.update).toHaveBeenCalledWith({
      where: { id: 'n2' },
      data: { content_target: 30, translation_target: 0, set_by_id: 'leader-1' },
    });
  });

  it('tháng trước không có KPI nào → vẫn ghi mốc (0 dòng) để không thử lại mỗi ngày', async () => {
    const { service, tx } = build();

    const result = await service.ensureMonthRollover('2026-11', 'CRON');

    expect(result).toEqual({ month: '2026-11', source_month: '2026-10', editor_kpis_copied: 0, creator_kpis_copied: 0 });
    expect(tx.kpiMonthRollover.create).toHaveBeenCalled();
    expect(tx.user.findMany).not.toHaveBeenCalled();
  });

  it('tiến trình khác vừa ghi mốc (P2002) → bỏ qua, trả null', async () => {
    const { service } = build({ txError: Object.assign(new Error('unique'), { code: 'P2002' }) });

    expect(await service.ensureMonthRollover('2026-11', 'CRON')).toBeNull();
  });

  it('lỗi khác → ném ra (transaction rollback cả mốc)', async () => {
    const { service } = build({ txError: new Error('timeout') });

    await expect(service.ensureMonthRollover('2026-11', 'CRON')).rejects.toThrow('timeout');
  });
});

describe('KpiRolloverService.cronRollover', () => {
  afterEach(() => jest.useRealTimers());

  it('lấy tháng theo giờ VN: 17:30 UTC ngày 31/10 = 00:30 ngày 1/11 ở VN → chép cho tháng 11', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T17:30:00Z'));
    const service = new KpiRolloverService({} as any);
    const spy = jest.spyOn(service, 'ensureMonthRollover').mockResolvedValue(null);

    await service.cronRollover();

    expect(spy).toHaveBeenCalledWith('2026-11', 'CRON');
  });

  it('lỗi chỉ ghi log, không ném ra khỏi cron', async () => {
    const service = new KpiRolloverService({} as any);
    jest.spyOn(service, 'ensureMonthRollover').mockRejectedValue(new Error('db down'));
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

    await expect(service.cronRollover()).resolves.toBeUndefined();
  });
});
