import { DateTime } from 'luxon';
import { TaskAutoAssignService } from '../task-auto-assign.service';
import { loadA4Editors, loadLineQuotas, splitDailyTotal } from '../steps/editor-eligibility';
import { loadLastAssignedByEditor, pickProductsForEditor } from '../steps/product-picker';
import { TeamProductCandidate } from '../types';

const VN = 'Asia/Ho_Chi_Minh';
// Chạy 17:00 ngày 9/10 (giờ VN) → ngày hiệu lực 10/10, còn 22 ngày (10→31/10).
const RUN_AT = DateTime.fromISO('2026-10-09T17:00:00', { zone: VN });

function product(id: string, extra: Partial<TeamProductCandidate> = {}): TeamProductCandidate {
  return {
    id,
    name: id,
    product_line_id: null,
    priority_score: 0,
    cooldown_days: null,
    source_product_id: null,
    sku: null,
    oms_variant_id: null,
    source_editor_product_id: null,
    ...extra,
  };
}

function member(userId: string, a4Quantity: number | null) {
  return {
    user: {
      id: userId,
      editor_kpis: a4Quantity == null ? [] : [{ allocations: [{ content_line_id: 'cl-a4', quantity: a4Quantity }] }],
    },
  };
}

describe('pickProductsForEditor — chọn SP kho team cho 1 editor', () => {
  const pick = (args: Partial<Parameters<typeof pickProductsForEditor>[0]>) =>
    pickProductsForEditor({
      pool: [],
      need: 0,
      lastAssigned: new Map(),
      pickedInRun: new Map(),
      defaultCooldownDays: 5,
      today: RUN_AT,
      ...args,
    }).map((p) => p.id);

  it('SP editor chưa từng làm lên trước, rồi SP làm lâu nhất — xoay vòng hết kho', () => {
    const ids = pick({
      pool: [product('p1'), product('p2'), product('p3')],
      need: 3,
      defaultCooldownDays: 0,
      lastAssigned: new Map([
        ['p1', new Date('2026-10-08T10:00:00Z')],
        ['p2', new Date('2026-09-20T10:00:00Z')],
      ]),
    });
    expect(ids).toEqual(['p3', 'p2', 'p1']);
  });

  it('SP đang cooldown KHÔNG BAO GIỜ được giao — kho không đủ SP khác thì giao thiếu', () => {
    const lastAssigned = new Map([['p1', new Date('2026-10-08T10:00:00Z')]]); // 8/10 VN → mới 1 ngày
    expect(pick({ pool: [product('p1'), product('p2')], need: 1, lastAssigned })).toEqual(['p2']);
    expect(pick({ pool: [product('p1'), product('p2')], need: 2, lastAssigned })).toEqual(['p2']);
    expect(pick({ pool: [product('p1')], need: 2, lastAssigned })).toEqual([]);
  });

  it('mốc 5 ngày: giao ở lượt chạy 4/10 → lượt 8/10 vẫn chặn, lượt 9/10 giao lại được', () => {
    // 4/10 17:00 VN = 4/10 10:00Z — task làm ngày 5/10; lượt 9/10 giao task làm ngày 10/10 (cách 5 ngày)
    const lastAssigned = new Map([['p1', new Date('2026-10-04T10:00:00Z')]]);
    const run8 = DateTime.fromISO('2026-10-08T17:00:00', { zone: VN });
    expect(pick({ pool: [product('p1')], need: 1, lastAssigned, today: run8 })).toEqual([]);
    expect(pick({ pool: [product('p1')], need: 1, lastAssigned, today: RUN_AT })).toEqual(['p1']);
    // Lượt chạy lúc 00:30 VN (= 17:30Z hôm trước) vẫn tính theo ngày lịch VN, không lệch theo giờ server
    const lateNight = new Map([['p1', new Date('2026-10-04T17:30:00Z')]]); // 5/10 00:30 VN
    expect(pick({ pool: [product('p1')], need: 1, lastAssigned: lateNight, today: RUN_AT })).toEqual([]);
  });

  it('cooldown riêng của SP thắng mặc định', () => {
    const lastAssigned = new Map([['p1', new Date('2026-10-08T10:00:00Z')]]);
    expect(pick({ pool: [product('p1', { cooldown_days: 0 })], need: 1, lastAssigned })).toEqual(['p1']);
    expect(
      pick({ pool: [product('p1', { cooldown_days: 10 })], need: 1, lastAssigned: new Map([['p1', new Date('2026-10-01T10:00:00Z')]]) }),
    ).toEqual([]);
  });

  it('rải SP cho cả team: SP đã giao cho người khác trong lượt này xếp sau', () => {
    const ids = pick({
      pool: [product('p1', { priority_score: 5 }), product('p2'), product('p3')],
      need: 2,
      pickedInRun: new Map([['p1', 1]]),
    });
    expect(ids).toEqual(['p2', 'p3']);
  });

  it('cùng điều kiện thì priority_score cao hơn lên trước', () => {
    expect(pick({ pool: [product('p1'), product('p2', { priority_score: 3 })], need: 1 })).toEqual(['p2']);
  });

  it('không lặp SP — kho ít hơn nhu cầu thì giao thiếu', () => {
    expect(pick({ pool: [product('p1'), product('p2')], need: 5 })).toEqual(['p1', 'p2']);
    expect(pick({ pool: [product('p1')], need: 0 })).toEqual([]);
  });
});

function a4Task(assigneeId: string, deadline: string, createdAt?: string) {
  return {
    assignee_id: assigneeId,
    content_line_id: 'cl-a4',
    deadline: new Date(deadline),
    created_at: createdAt ? new Date(createdAt) : new Date(),
  };
}

describe('loadA4Editors — số task A4 còn thiếu cho ngày hiệu lực', () => {
  function buildPrisma(members: any[], tasks: any[]) {
    return {
      teamMember: { findMany: jest.fn(async () => members) },
      task: { findMany: jest.fn(async () => tasks) },
    } as any;
  }

  it('rải KPI A4 còn lại đều cho các ngày còn lại, trừ task đã có hạn vào ngày hiệu lực', async () => {
    // KPI 50, đã có 6 task hạn trước 10/10 → còn 44 / 22 ngày = 2 task/ngày; đã có 1 task hạn 10/10.
    const prisma = buildPrisma(
      [member('u1', 50), member('u2', null)],
      [
        ...Array.from({ length: 6 }, () => a4Task('u1', '2026-10-05T10:00:00Z')),
        a4Task('u1', '2026-10-10T10:00:00Z'),
        a4Task('u1', '2026-10-20T10:00:00Z'),
      ],
    );

    const editors = await loadA4Editors(prisma, 'team-1', 'cl-a4', RUN_AT, '2026-10');

    expect(editors).toEqual([{ userId: 'u1', monthlyTarget: 50, assignedThisMonth: 8, remainingToday: 1 }]);
    const where = prisma.task.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ assignee_id: { in: ['u1'] }, team_id: 'team-1', content_line_id: { in: ['cl-a4'] } });
    expect(where.OR[0].deadline).toEqual({
      gte: new Date('2026-09-30T17:00:00Z'), // 1/10 00:00 giờ VN
      lt: new Date('2026-10-31T17:00:00Z'),
    });
  });

  it('chạy ngày cuối tháng: đếm theo tháng của ngày mai, task hạn 1/10 tính là việc ngày hiệu lực', async () => {
    const runAt = DateTime.fromISO('2026-09-30T17:00:00', { zone: VN }); // → ngày hiệu lực 1/10
    // KPI tháng 10 = 62 → 2 task/ngày; 1 task (tạo tay hôm nay) đã có hạn 1/10.
    const prisma = buildPrisma(
      [member('u1', 62)],
      [a4Task('u1', '2026-10-01T10:00:00Z', '2026-09-30T03:00:00Z')],
    );

    const editors = await loadA4Editors(prisma, 'team-1', 'cl-a4', runAt, '2026-10');

    expect(editors).toEqual([{ userId: 'u1', monthlyTarget: 62, assignedThisMonth: 1, remainingToday: 1 }]);
  });

  it('đã đủ task A4 cho ngày hiệu lực → không nhận thêm', async () => {
    const prisma = buildPrisma(
      [member('u1', 22)],
      [a4Task('u1', '2026-10-10T10:00:00Z')],
    );
    expect(await loadA4Editors(prisma, 'team-1', 'cl-a4', RUN_AT, '2026-10')).toEqual([]);
  });

  it('không ai có KPI A4 → không query task', async () => {
    const prisma = buildPrisma([member('u1', null), member('u2', 0)], []);
    expect(await loadA4Editors(prisma, 'team-1', 'cl-a4', RUN_AT, '2026-10')).toEqual([]);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });
});

describe('loadLineQuotas — chỉ tiêu ngày theo từng tuyến (dùng chung cho Kế hoạch ngày)', () => {
  it('mỗi (editor, tuyến) 1 chỉ tiêu riêng; đã đủ task ngày hiệu lực vẫn trả về (remaining = 0)', async () => {
    const members = [{
      user: {
        id: 'u1',
        editor_kpis: [{ allocations: [
          { content_line_id: 'cl-a1', quantity: 44 },
          { content_line_id: 'cl-a2', quantity: 22 },
        ] }],
      },
    }];
    const tasks = [
      { assignee_id: 'u1', content_line_id: 'cl-a1', deadline: new Date('2026-10-10T10:00:00Z'), created_at: new Date() },
      { assignee_id: 'u1', content_line_id: 'cl-a2', deadline: new Date('2026-10-10T10:00:00Z'), created_at: new Date() },
    ];
    const prisma: any = {
      teamMember: { findMany: jest.fn(async () => members) },
      task: { findMany: jest.fn(async () => tasks) },
    };

    const quotas = await loadLineQuotas(prisma, 'team-1', ['cl-a1', 'cl-a2'], RUN_AT, '2026-10');

    // 44 / 22 ngày = 2/ngày (đã có 1 → còn 1); 22 / 22 = 1/ngày (đã có 1 → đủ)
    expect(quotas).toEqual([
      { userId: 'u1', contentLineId: 'cl-a1', monthlyTarget: 44, assignedThisMonth: 1, dailyTarget: 2, onDay: 1, remainingToday: 1 },
      { userId: 'u1', contentLineId: 'cl-a2', monthlyTarget: 22, assignedThisMonth: 1, dailyTarget: 1, onDay: 1, remainingToday: 0 },
    ]);
    expect(prisma.task.findMany.mock.calls[0][0].where.content_line_id).toEqual({ in: ['cl-a1', 'cl-a2'] });
  });

  // KPI 140/tháng thật của 1 editor K3: A1 49, A2 21, A3 14, A4 56.
  const K3_KPI = { 'cl-a1': 49, 'cl-a2': 21, 'cl-a3': 14, 'cl-a4': 56 };
  const k3Member = () => ({
    user: {
      id: 'u1',
      editor_kpis: [{ allocations: Object.entries(K3_KPI).map(([content_line_id, quantity]) => ({ content_line_id, quantity })) }],
    },
  });
  const LINES = Object.keys(K3_KPI);

  it('chia TỔNG KPI mọi tuyến theo ngày rồi mới chia cho tuyến — 140/31 ngày = 5 việc, không phải 6', async () => {
    const tasks: any[] = [];
    const prisma: any = {
      teamMember: { findMany: jest.fn(async () => [k3Member()]) },
      task: { findMany: jest.fn(async () => tasks) },
    };
    const runAt = DateTime.fromISO('2026-09-30T17:00:00', { zone: VN }); // → ngày hiệu lực 1/10, còn 31 ngày

    const quotas = await loadLineQuotas(prisma, 'team-1', LINES, runAt, '2026-10');
    expect(quotas.map((q) => [q.contentLineId, q.dailyTarget])).toEqual([['cl-a1', 2], ['cl-a2', 1], ['cl-a4', 2]]);

    // Chỉ hỏi A4 vẫn chia trên tổng 4 tuyến, và đếm task của mọi tuyến
    const a4 = await loadA4Editors(prisma, 'team-1', 'cl-a4', runAt, '2026-10');
    expect(a4).toEqual([{ userId: 'u1', monthlyTarget: 56, assignedThisMonth: 0, remainingToday: 2 }]);
    expect(prisma.task.findMany.mock.calls[1][0].where.content_line_id).toEqual({ in: LINES });
  });

  it('cả tháng 10 (giao cả cuối tuần): mỗi ngày 4–5 việc, hết tháng đủ đúng KPI từng tuyến', async () => {
    const tasks: any[] = [];
    const prisma: any = {
      teamMember: { findMany: jest.fn(async () => [k3Member()]) },
      task: { findMany: jest.fn(async () => tasks) },
    };
    const dailyTotals: number[] = [];
    for (let day = 1; day <= 31; day++) {
      const runAt = DateTime.fromISO('2026-09-30T17:00:00', { zone: VN }).plus({ days: day - 1 });
      const quotas = await loadLineQuotas(prisma, 'team-1', LINES, runAt, '2026-10');
      dailyTotals.push(quotas.reduce((s, q) => s + q.remainingToday, 0));
      // Editor làm đúng chỉ tiêu: task hạn 17:00 VN ngày hiệu lực
      const deadline = new Date(Date.UTC(2026, 9, day, 10));
      for (const q of quotas) {
        for (let i = 0; i < q.remainingToday; i++) {
          tasks.push({ assignee_id: 'u1', content_line_id: q.contentLineId, deadline, created_at: deadline });
        }
      }
    }

    expect(new Set(dailyTotals)).toEqual(new Set([4, 5]));
    const done = Object.fromEntries(LINES.map((l) => [l, tasks.filter((t) => t.content_line_id === l).length]));
    expect(done).toEqual(K3_KPI);
  });
});

describe('splitDailyTotal — chia việc trong ngày cho các tuyến theo phần KPI còn lại', () => {
  const split = (total: number, remaining: Record<string, number>) =>
    Object.fromEntries(splitDailyTotal(total, Object.entries(remaining).map(([id, r]) => ({ id, remaining: r }))));

  it('phần nguyên theo tỷ lệ, số dư cho phần lẻ lớn nhất (bằng nhau → tuyến còn nhiều hơn)', () => {
    // 5 × 49/140 = 1,75 | 5 × 21/140 = 0,75 | 5 × 14/140 = 0,5 | 5 × 56/140 = 2
    expect(split(5, { a1: 49, a2: 21, a3: 14, a4: 56 })).toEqual({ a1: 2, a2: 1, a3: 0, a4: 2 });
  });

  it('không vượt phần còn lại của tuyến; tổng = 0 hoặc hết KPI → toàn 0', () => {
    expect(split(3, { a1: 3, a2: 0 })).toEqual({ a1: 3, a2: 0 });
    expect(split(0, { a1: 10 })).toEqual({});
    expect(split(2, { a1: 0 })).toEqual({});
  });
});

function teamProductRow(id: string, extra: Record<string, any> = {}) {
  return {
    id, name: `SP ${id}`, sku: null, oms_variant_id: null, product_line_id: 'pl-gmv', priority_score: 0,
    cooldown_days: null, source_product_id: null, source_editor_product_id: null, source_editor_product: null,
    ...extra,
  };
}

function historyRow(assigneeId: string, assignedAt: string, product: Record<string, any>) {
  return {
    assignee_id: assigneeId,
    assigned_at: new Date(assignedAt),
    team_product: null,
    editor_product: null,
    product: null,
    ...product,
  };
}

describe('loadLastAssignedByEditor — lịch sử giao SP theo người, khớp SP qua mọi kho', () => {
  it('task gắn SP kho cá nhân / kho tổng / kho team khác cùng SP đều tính cho SP kho team', async () => {
    const pool = [
      product('tp1', { sku: 'N0014', oms_variant_id: 'v1', source_product_id: 'g1' }),
      product('tp2', { source_editor_product_id: 'ep-origin' }),
      product('tp3'),
    ];
    const rows = [
      historyRow('u1', '2026-10-08T10:00:00Z', {
        editor_product: { id: 'ep-x', sku: ' n0014 ', oms_variant_id: null, source_product_id: null },
      }),
      historyRow('u1', '2026-10-06T10:00:00Z', { product: { id: 'g1', sku: null, source_team_product_id: null } }),
      historyRow('u1', '2026-10-04T10:00:00Z', { product: { id: 'g9', sku: 'ZZZ', source_team_product_id: 'tp3' } }),
      historyRow('u1', '2026-10-09T10:00:00Z', {
        editor_product: { id: 'ep-y', sku: 'OTHER', oms_variant_id: null, source_product_id: null },
      }),
      historyRow('u2', '2026-10-07T10:00:00Z', {
        editor_product: { id: 'ep-origin', sku: 'X1', oms_variant_id: null, source_product_id: null },
      }),
      // SP kho team của team khác, cùng OMS variant
      historyRow('u2', '2026-10-05T10:00:00Z', { team_product: teamProductRow('tp-other-team', { oms_variant_id: 'v1' }) }),
    ];
    const prisma: any = { task: { findMany: jest.fn(async () => rows) } };

    const result = await loadLastAssignedByEditor(prisma, ['u1', 'u2'], pool, new Date('2026-08-10T00:00:00Z'));

    expect(result.get('u1')).toEqual(new Map([
      ['tp1', new Date('2026-10-08T10:00:00Z')],
      ['tp3', new Date('2026-10-04T10:00:00Z')],
    ]));
    expect(result.get('u2')).toEqual(new Map([
      ['tp2', new Date('2026-10-07T10:00:00Z')],
      ['tp1', new Date('2026-10-05T10:00:00Z')],
    ]));
    // Cooldown theo người, không giới hạn team của task
    const where = prisma.task.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ assignee_id: { in: ['u1', 'u2'] }, status: { not: 'CANCELLED' } });
    expect(where.team_id).toBeUndefined();
  });
});

describe('TaskAutoAssignService.runDailyAssignment — chia task A4 theo KPI + kho sản phẩm team', () => {
  function buildService(opts: {
    contentLine?: any; products?: any[]; history?: any[]; defaultCooldownDays?: number | null;
    settings?: Record<string, any>; dailyPlans?: () => Promise<any>; kpiRollover?: () => Promise<any>;
  } = {}) {
    const tx = {
      task: { createMany: jest.fn(async () => ({})) },
      taskAssignment: { createMany: jest.fn(async () => ({})) },
      notification: { createMany: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      autoAssignSetting: {
        findUnique: jest.fn(async () => ({
          is_active: true,
          weekend_enabled: true,
          default_cooldown_days: opts.defaultCooldownDays === undefined ? 5 : opts.defaultCooldownDays,
          daily_plan_line_names: ['A1', 'A2', 'A3', 'A5'],
          ...opts.settings,
        })),
      },
      assignmentRun: {
        create: jest.fn(async () => ({ id: 'run-1' })),
        update: jest.fn(async () => ({})),
      },
      contentLine: {
        findFirst: jest.fn(async () => (opts.contentLine === undefined ? { id: 'cl-a4', name: 'A4' } : opts.contentLine)),
      },
      team: { findMany: jest.fn(async () => [{ id: 'team-1', name: 'Team K4', brand_type: 'TRANG_SUC', market: 'VIETNAM' }]) },
      // KPI A4 tháng 10: u1 = 44 (2 task/ngày), u2 = 22 (1 task/ngày)
      teamMember: { findMany: jest.fn(async () => [member('u1', 44), member('u2', 22)]) },
      task: {
        // Cùng 1 hàm cho 2 query: đếm task A4 (lọc content_line_id) và lịch sử giao SP (cooldown)
        findMany: jest.fn(async (args: any) => (args.where.content_line_id ? [] : opts.history ?? [])),
      },
      teamProduct: {
        findMany: jest.fn(async () =>
          opts.products ?? ['p1', 'p2', 'p3', 'p4'].map((id) => ({
            id, name: `SP ${id}`, sku: `SKU-${id}`, oms_variant_id: null, product_line_id: 'pl-gmv',
            priority_score: 0, cooldown_days: null, source_product_id: null,
            source_editor_product_id: null, source_editor_product: null,
          })),
        ),
      },
      editorSource: { findMany: jest.fn(async () => []) },
      teamSource: { findMany: jest.fn(async () => []) },
      source: { findMany: jest.fn(async () => []) },
      notification: { createMany: jest.fn(async () => ({})) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const push: any = { sendToUser: jest.fn(async () => ({})) };
    const dailyPlanBuilder: any = {
      buildDailyPlans: jest.fn(opts.dailyPlans ?? (async () => ({ plan_date: '2026-10-10', lines: ['A1'], plans: 2, suggestions: 8, teams: {} }))),
    };
    const kpiRollover: any = { ensureMonthRollover: jest.fn(opts.kpiRollover ?? (async () => null)) };
    return {
      service: new TaskAutoAssignService(prisma, push, dailyPlanBuilder, kpiRollover),
      prisma, tx, dailyPlanBuilder, kpiRollover,
    };
  }

  it('tạo task AUTO tuyến A4 chỉ gắn SP kho team, không gắn content, mỗi task 1 SP khác nhau', async () => {
    const { service, prisma, tx } = buildService({
      // u1 vừa làm p1 hôm qua → đang cooldown
      history: [historyRow('u1', '2026-10-08T10:00:00Z', { team_product: teamProductRow('p1', { sku: 'SKU-p1' }) })],
    });

    const result = await service.runDailyAssignment(RUN_AT, true);

    expect(result).toEqual({ assigned: 3, skipped: 0, runId: 'run-1' });
    const rows = (tx.task.createMany.mock.calls[0] as any)[0].data;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        team_id: 'team-1',
        content_line_id: 'cl-a4',
        product_line_id: 'pl-gmv',
        task_type: 'AUTO',
        is_product_push: true,
        status: 'ASSIGNED',
        run_id: 'run-1',
      });
      expect(row.content_id).toBeUndefined();
      expect(row.team_content_id).toBeUndefined();
      expect(row.editor_content_id).toBeUndefined();
    }
    const u1Products = rows.filter((r: any) => r.assignee_id === 'u1').map((r: any) => r.team_product_id);
    const u2Products = rows.filter((r: any) => r.assignee_id === 'u2').map((r: any) => r.team_product_id);
    expect(u1Products).toHaveLength(2);
    expect(u1Products).not.toContain('p1');
    expect(u2Products).toHaveLength(1);
    expect(new Set(rows.map((r: any) => r.team_product_id)).size).toBe(3);
    // Kho sản phẩm team = SP đang bật đúng brand
    expect(prisma.teamProduct.findMany.mock.calls[0][0].where).toEqual({
      team_id: 'team-1', is_active: true, brand_type: 'TRANG_SUC',
    });
    expect(prisma.assignmentRun.update.mock.calls[0][0].data).toMatchObject({
      status: 'DONE', total_assigned: 3, total_skipped: 0,
    });
  });

  it('task tạo tay gắn cùng SKU từ kho cá nhân vẫn chặn SP đó 5 ngày — kho không đủ thì giao thiếu', async () => {
    const { service, prisma, tx } = buildService({
      products: [teamProductRow('p1', { sku: 'N0014' })],
      // u1 tự tạo task hôm qua với SP kho cá nhân cùng SKU (khác hoa thường)
      history: [historyRow('u1', '2026-10-08T10:00:00Z', {
        editor_product: { id: 'ep-9', sku: 'n0014', oms_variant_id: null, source_product_id: null },
      })],
    });

    const result = await service.runDailyAssignment(RUN_AT, true);

    // u1 cần 2 nhưng SP duy nhất đang cooldown → 0; u2 cần 1 → nhận p1
    expect(result).toEqual({ assigned: 1, skipped: 2, runId: 'run-1' });
    const rows = (tx.task.createMany.mock.calls[0] as any)[0].data;
    expect(rows.map((r: any) => [r.assignee_id, r.team_product_id])).toEqual([['u2', 'p1']]);
    expect(prisma.assignmentRun.update.mock.calls[0][0].data).toMatchObject({ total_assigned: 1, total_skipped: 2 });
  });

  it('settings chưa có default_cooldown_days → mặc định giãn cách 5 ngày', async () => {
    const { service, tx } = buildService({
      defaultCooldownDays: null,
      products: [teamProductRow('p1'), teamProductRow('p2')],
      // u1 làm p1 lượt 5/10 (cách 4 ngày → còn chặn), p2 lượt 4/10 (cách 5 ngày → giao lại được)
      history: [
        historyRow('u1', '2026-10-05T10:00:00Z', { team_product: teamProductRow('p1') }),
        historyRow('u1', '2026-10-04T10:00:00Z', { team_product: teamProductRow('p2') }),
      ],
    });

    await service.runDailyAssignment(RUN_AT, true);

    const rows = (tx.task.createMany.mock.calls[0] as any)[0].data;
    // u1 cần 2 nhưng p1 còn cooldown → chỉ nhận p2 (cooldown 0 thì sẽ nhận cả p1)
    expect(rows.filter((r: any) => r.assignee_id === 'u1').map((r: any) => r.team_product_id)).toEqual(['p2']);
  });

  it('kho sản phẩm team trống → không tạo task, báo từng editor số video A4 cần làm', async () => {
    const { service, prisma, tx } = buildService({ products: [] });

    const result = await service.runDailyAssignment(RUN_AT, true);

    expect(result).toEqual({ assigned: 0, skipped: 3, runId: 'run-1' });
    expect(tx.task.createMany).not.toHaveBeenCalled();
    const notices = prisma.notification.createMany.mock.calls[0][0].data;
    expect(notices).toEqual([
      expect.objectContaining({
        user_id: 'u1',
        type: 'AUTO_ASSIGN_EMPTY_WAREHOUSE',
        meta: { videosNeededToday: 2, productKpi: null, contentLines: [{ id: 'cl-a4', name: 'A4', count: 2 }] },
      }),
      expect.objectContaining({ user_id: 'u2', meta: expect.objectContaining({ videosNeededToday: 1 }) }),
    ]);
  });

  it('không tìm thấy tuyến A4 → run FAILED, không tạo gì', async () => {
    const { service, prisma, tx } = buildService({ contentLine: null });

    await expect(service.runDailyAssignment(RUN_AT, true)).rejects.toThrow('A4');

    expect(prisma.assignmentRun.update.mock.calls[0][0].data.status).toBe('FAILED');
    expect(tx.task.createMany).not.toHaveBeenCalled();
  });

  it('cùng lượt lập Kế hoạch ngày cho các tuyến trong settings, ghi tóm tắt vào details của run', async () => {
    const { service, prisma, dailyPlanBuilder } = buildService();

    await service.runDailyAssignment(RUN_AT, true);

    const args = dailyPlanBuilder.buildDailyPlans.mock.calls[0][0];
    expect(args).toMatchObject({ lineNames: ['A1', 'A2', 'A3', 'A5'], month: '2026-10', runId: 'run-1' });
    expect(args.teams.map((t: any) => t.id)).toEqual(['team-1']);
    // Hạn chót task tạo nhanh = hạn task A4 cùng lượt (giờ chạy + 1 ngày)
    expect(args.deadline).toEqual(new Date('2026-10-10T10:00:00Z'));
    const data = prisma.assignmentRun.update.mock.calls[0][0].data;
    expect(data.status).toBe('DONE');
    expect(data.details._daily_plans).toMatchObject({ plans: 2, suggestions: 8 });
  });

  it('tắt Kế hoạch ngày → chỉ chia A4', async () => {
    const { service, dailyPlanBuilder } = buildService({ settings: { daily_plan_enabled: false } });

    const result = await service.runDailyAssignment(RUN_AT, true);

    expect(result.assigned).toBe(3);
    expect(dailyPlanBuilder.buildDailyPlans).not.toHaveBeenCalled();
  });

  it('lập Kế hoạch ngày lỗi → task A4 vẫn giữ, run vẫn DONE, lỗi ghi vào details', async () => {
    const { service, prisma, tx } = buildService({
      dailyPlans: async () => { throw new Error('scraper down'); },
    });

    const result = await service.runDailyAssignment(RUN_AT, true);

    expect(result.assigned).toBe(3);
    expect(tx.task.createMany).toHaveBeenCalled();
    const data = prisma.assignmentRun.update.mock.calls[0][0].data;
    expect(data.status).toBe('DONE');
    expect(data.details._daily_plans).toEqual({ error: 'scraper down' });
  });

  it('lượt chạy ngày cuối tháng chép KPI cho tháng SAU trước khi đọc KPI, ghi kết quả vào details', async () => {
    const copied = { month: '2026-11', source_month: '2026-10', editor_kpis_copied: 2, creator_kpis_copied: 0 };
    const { service, prisma, kpiRollover } = buildService({ kpiRollover: async () => copied });

    await service.runDailyAssignment(DateTime.fromISO('2026-10-31T17:00:00', { zone: VN }), true);

    expect(kpiRollover.ensureMonthRollover).toHaveBeenCalledWith('2026-11', 'AUTO_ASSIGN');
    expect(kpiRollover.ensureMonthRollover.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.teamMember.findMany.mock.invocationCallOrder[0]);
    expect(prisma.assignmentRun.update.mock.calls[0][0].data.details._kpi_rollover).toEqual(copied);
  });

  it('chép KPI lỗi → vẫn chia task theo KPI đang có, run DONE, lỗi ghi vào details', async () => {
    const { service, prisma } = buildService({ kpiRollover: async () => { throw new Error('db timeout'); } });

    const result = await service.runDailyAssignment(RUN_AT, true);

    expect(result.assigned).toBe(3);
    const data = prisma.assignmentRun.update.mock.calls[0][0].data;
    expect(data.status).toBe('DONE');
    expect(data.details._kpi_rollover).toEqual({ error: 'db timeout' });
  });

  it('tháng đã chép từ trước (null) → details không có _kpi_rollover', async () => {
    const { service, prisma } = buildService();

    await service.runDailyAssignment(RUN_AT, true);

    expect(prisma.assignmentRun.update.mock.calls[0][0].data.details).not.toHaveProperty('_kpi_rollover');
  });

  it('tắt cuối tuần: xét theo NGÀY ĐƯỢC CHIA (ngày mai) — tối T6 bỏ qua, tối CN vẫn chạy cho T2', async () => {
    const friday = buildService({ settings: { weekend_enabled: false } });
    expect(await friday.service.runDailyAssignment(RUN_AT, true)).toEqual({ assigned: 0, skipped: 0, runId: '' });
    expect(friday.prisma.assignmentRun.create).not.toHaveBeenCalled();

    const sunday = buildService({ settings: { weekend_enabled: false } });
    const sundayRun = DateTime.fromISO('2026-10-11T17:00:00', { zone: VN });
    expect((await sunday.service.runDailyAssignment(sundayRun, true)).runId).toBe('run-1');
  });
});
