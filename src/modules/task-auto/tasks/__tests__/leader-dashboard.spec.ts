import { TaskAutoTasksService } from '../tasks.service';

/**
 * getLeaderDashboard (qua getDashboard) — bug gốc: dùng `team.findFirst({leader_id})` để tìm team
 * của leader, nhưng trên DB thật có leader lead CÙNG LÚC nhiều team (vd 1 người lead cả "Scale Data",
 * "Team K1", "MEDIA" — 15 thành viên thô, 12 người thật sau khi bỏ trùng vì có người ở ≥2 team).
 * findFirst chỉ trả 1/N team, làm mất dữ liệu các team còn lại. Đã sửa sang findMany + gộp/dedupe —
 * test này khoá lại hành vi đúng để tránh regression về findFirst.
 */
describe('TaskAutoTasksService.getDashboard — leader lead nhiều team', () => {
  function build(teamsLed: any[]) {
    const push: any = {};
    const videoService: any = {};
    // linkStats chỉ được dùng ở nhánh refresh chỉ số link đã đăng, không nằm trong đường
    // đi của getDashboard — nhưng vẫn PHẢI truyền vì nó là tham số constructor thứ 4.
    // Thiếu nó thì suite hỏng ngay từ khâu biên dịch (TS2554), không phải lúc chạy.
    const linkStats: any = {};
    const prisma: any = {
      team: { findMany: jest.fn(async () => teamsLed) },
      task: {
        groupBy: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        // getContentFreshnessByAssignee (content_new/content_old) đọc task.findMany — không nằm
        // trong phạm vi describe này (xem describe "content_new / content_old" bên dưới), nhưng
        // thiếu mock này thì suite hỏng ngay ở lời gọi biên dịch được, không phải lúc assert.
        findMany: jest.fn(async () => []),
      },
      editorKpi: { findMany: jest.fn(async () => []) },
      trafficReport: { findMany: jest.fn(async () => []) },
      revenueReport: { groupBy: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => []) },
      editorDailyKpi: { findMany: jest.fn(async () => []) },
      // getApprovedProductLineBreakdown (product_by_category) đọc productLine.findMany luôn, kể cả
      // khi task.findMany rỗng — thiếu mock này thì suite hỏng ngay ở lời gọi, không phải lúc assert.
      productLine: { findMany: jest.fn(async () => []) },
      // getContentCreatorStats (content_collected_month/content_original_month) luôn được gọi song
      // song với editorKpis/editorDailyKpi — thiếu mock này thì suite hỏng ngay ở lời gọi.
      contentCreatorKpi: { findMany: jest.fn(async () => []) },
      editorApproval: { findMany: jest.fn(async () => []) },
      teamContent: { groupBy: jest.fn(async () => []) },
      contentCreatorDailyKpi: { findMany: jest.fn(async () => []) },
      teamPushRequest: { groupBy: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, videoService, push, linkStats);
    return { service, prisma };
  }

  function fakeMember(userId: string, name: string) {
    return { user_id: userId, user: { id: userId, full_name: name, email: `${name}@x.com` } };
  }

  it('gộp đúng 3 team của cùng 1 leader — KHÔNG chỉ lấy 1 team đầu tiên', async () => {
    const shared = fakeMember('u-shared', 'Người dùng chung'); // ở cả "Scale Data" và "Team K1"
    const teamsLed = [
      { id: 't-scale', name: 'Scale Data', members: [shared, fakeMember('u1', 'A')] },
      { id: 't-k1', name: 'Team K1', members: [shared, fakeMember('u2', 'B'), fakeMember('u3', 'C')] },
      { id: 't-media', name: 'MEDIA', members: [fakeMember('u4', 'D')] },
    ];
    const { service, prisma } = build(teamsLed);

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);

    expect(prisma.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leader_id: 'leader-1' } }),
    );
    expect(result.scope).toBe('team');
    // Cả 3 tên team phải xuất hiện, không được chỉ có 1
    expect(result.team.name).toBe('Scale Data, Team K1, MEDIA');
    // 2+3+1 = 6 dòng thô nhưng "u-shared" xuất hiện ở 2 team → dedupe còn 5 người thật
    expect(result.team.member_count).toBe(5);
    expect(result.members).toHaveLength(5);
    expect(result.members.map((m: any) => m.user_id).sort()).toEqual(
      ['u-shared', 'u1', 'u2', 'u3', 'u4'].sort(),
    );

    // task.groupBy/task.count phải lọc theo TẤT CẢ team_id của leader, không chỉ team đầu
    const teamIdFilters = prisma.task.groupBy.mock.calls.map((c: any[]) => c[0]?.where?.team_id).filter(Boolean);
    for (const f of teamIdFilters) {
      expect(f).toEqual({ in: ['t-scale', 't-k1', 't-media'] });
    }
  });

  it('leader không lead team nào → trả về rỗng, không throw', async () => {
    const { service } = build([]);

    const result: any = await service.getDashboard('leader-no-team', ['LEADER'], undefined, undefined);

    expect(result).toEqual({
      scope: 'team',
      team: null,
      tasks: { total: 0 },
      members: [],
      kpi: null,
      video_by_line: [],
      product_by_category: [],
    });
  });

  it('leader lead đúng 1 team (trường hợp phổ biến nhất) vẫn hoạt động bình thường', async () => {
    const teamsLed = [{ id: 't-jp1', name: 'Global - JP1', members: [fakeMember('u1', 'A'), fakeMember('u2', 'B')] }];
    const { service } = build(teamsLed);

    const result: any = await service.getDashboard('leader-single', ['LEADER'], undefined, undefined);

    expect(result.team).toEqual({ id: 't-jp1', name: 'Global - JP1', member_count: 2 });
    expect(result.members).toHaveLength(2);
  });
});

/**
 * getLeaderDashboard (qua getDashboard) — bug gốc: trang /dashboard/task-auto gửi `date_from`/
 * `date_to` (bộ lọc ngày trên UI) lên BE, nhưng BE chỉ dùng `range` đó để đếm trạng thái task tổng,
 * còn TOÀN BỘ số liệu "thực tế trong kỳ" khác (video theo tuyến, task đã duyệt, traffic, doanh thu,
 * content mới/cũ, sản phẩm theo dòng) vẫn khoá cứng theo tháng thực tế lúc gọi API — bộ lọc ngày trên
 * UI không có tác dụng gì với các khối này. Đã sửa: thêm `periodRange = range ?? {tháng đang xem}`,
 * áp dụng cho mọi query "thực tế trong kỳ". Test này khoá lại hành vi đúng để tránh regression.
 */
describe('TaskAutoTasksService.getDashboard — leader dashboard theo bộ lọc ngày', () => {
  function build() {
    const teamsLed = [
      {
        id: 't-1',
        name: 'Team X',
        members: [{ user_id: 'u1', user: { id: 'u1', full_name: 'A', email: 'a@x.com' } }],
      },
    ];
    const prisma: any = {
      team: { findMany: jest.fn(async () => teamsLed) },
      task: {
        groupBy: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
      editorKpi: { findMany: jest.fn(async () => []) },
      trafficReport: { findMany: jest.fn(async () => []) },
      revenueReport: { groupBy: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => []) },
      editorDailyKpi: { findMany: jest.fn(async () => []) },
      productLine: { findMany: jest.fn(async () => []) },
      contentCreatorKpi: { findMany: jest.fn(async () => []) },
      editorApproval: { findMany: jest.fn(async () => []) },
      teamContent: { groupBy: jest.fn(async () => []) },
      contentCreatorDailyKpi: { findMany: jest.fn(async () => []) },
      teamPushRequest: { groupBy: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  afterEach(() => jest.clearAllMocks());

  it('trang Task Auto truyền date_from/date_to (không có month) → mọi số liệu thực tế trong kỳ dùng đúng khoảng ngày đó', async () => {
    const { service, prisma } = build();

    await service.getDashboard('leader-1', ['LEADER'], '2026-01-05', '2026-01-10');

    const expectedRange = { gte: new Date(2026, 0, 5), lt: new Date(2026, 0, 11) };

    // Task đã duyệt của cả team (KPI completed)
    expect(prisma.task.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ reviewed_at: expectedRange }) }),
    );
    // Task đã duyệt theo từng member (kpi_completed)
    expect(prisma.task.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['assignee_id'],
        where: expect.objectContaining({ status: 'APPROVED', reviewed_at: expectedRange }),
      }),
    );
    // Video theo tuyến nội dung
    expect(prisma.task.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['content_line_id'],
        where: expect.objectContaining({ reviewed_at: expectedRange }),
      }),
    );
    // Content mới/cũ (getContentFreshnessByAssignee đọc task.findMany theo created_at)
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ created_at: expectedRange }) }),
    );
    // Sản phẩm theo dòng (getApprovedProductLineBreakdown đọc task.findMany theo reviewed_at)
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'APPROVED', reviewed_at: expectedRange }),
      }),
    );
    // Traffic báo cáo hằng ngày
    expect(prisma.trafficReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ date: expectedRange }) }),
    );
    // Doanh thu báo cáo hằng ngày
    expect(prisma.revenueReport.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ date: expectedRange }) }),
    );
  });

  it('KPI target (EditorKpi) không có khái niệm theo ngày tuỳ ý → suy ra tháng từ ngày bắt đầu bộ lọc, không phải tháng thực tế', async () => {
    const { service, prisma } = build();

    const result: any = await service.getDashboard('leader-1', ['LEADER'], '2025-03-10', '2025-03-15');

    expect(result.kpi.month).toBe('2025-03');
    expect(prisma.editorKpi.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ month: '2025-03' }) }),
    );
  });

  it('trang /dashboard/leader chỉ truyền `month` (không có date_from/date_to) → vẫn dùng nguyên cả tháng đó như cũ', async () => {
    const { service, prisma } = build();

    await service.getDashboard('leader-1', ['LEADER'], undefined, undefined, '2025-11');

    const expectedMonthRange = { gte: new Date(2025, 10, 1), lt: new Date(2025, 11, 1) };

    expect(prisma.task.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ reviewed_at: expectedMonthRange }) }),
    );
    expect(prisma.editorKpi.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ month: '2025-11' }) }),
    );
  });
});

/**
 * getLeaderDashboard — bug gốc: leader luôn có mặt trong TeamMember của chính team mình lead
 * (invariant kỹ thuật ở teams.service.ts create()/update(), không phải quy ước nghiệp vụ), nên
 * dashboard hiện card KPI rỗng cho tài khoản leader thuần quản lý, dù họ không hề sản xuất video/
 * content. Đã sửa: chỉ hiện member là content creator hoặc đã được duyệt editor (EditorApproval
 * APPROVED); member không mang role quản lý (LEADER/ADMIN/MANAGER) vẫn hiện như cũ (mặc định coi
 * là editor, dù chưa qua duyệt) để không ẩn nhầm editor thật.
 */
describe('TaskAutoTasksService.getDashboard — chỉ hiện member là editor/content creator', () => {
  function build(opts: { members: any[]; approvedEditorUserIds?: string[] }) {
    const teamsLed = [{ id: 't-1', name: 'Team X', members: opts.members }];
    const prisma: any = {
      team: { findMany: jest.fn(async () => teamsLed) },
      task: {
        groupBy: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
      editorKpi: { findMany: jest.fn(async () => []) },
      trafficReport: { findMany: jest.fn(async () => []) },
      revenueReport: { groupBy: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => []) },
      editorDailyKpi: { findMany: jest.fn(async () => []) },
      productLine: { findMany: jest.fn(async () => []) },
      contentCreatorKpi: { findMany: jest.fn(async () => []) },
      teamContent: { groupBy: jest.fn(async () => []) },
      contentCreatorDailyKpi: { findMany: jest.fn(async () => []) },
      teamPushRequest: { groupBy: jest.fn(async () => []) },
      editorApproval: {
        findMany: jest.fn(async () =>
          (opts.approvedEditorUserIds ?? []).map((user_id) => ({ user_id })),
        ),
      },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  function member(userId: string, name: string, roles: string[], isContentCreator = false) {
    return {
      user_id: userId,
      is_content_creator: isContentCreator,
      user: { id: userId, full_name: name, email: `${name}@x.com`, roles },
    };
  }

  it('leader thuần quản lý (không content creator, chưa được duyệt editor) KHÔNG hiện card', async () => {
    const { service } = build({
      members: [
        member('leader-pure', 'Leader thuần', ['LEADER']),
        member('editor-1', 'Editor A', ['MEMBER']),
      ],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);

    expect(result.members.map((m: any) => m.user_id)).toEqual(['editor-1']);
    expect(result.team.member_count).toBe(1);
  });

  it('leader kiêm content creator (is_content_creator=true) vẫn hiện card', async () => {
    const { service } = build({
      members: [member('leader-cc', 'Leader kiêm CC', ['LEADER'], true)],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);

    expect(result.members.map((m: any) => m.user_id)).toEqual(['leader-cc']);
  });

  it('leader đã được duyệt editor (EditorApproval APPROVED) vẫn hiện card', async () => {
    const { service } = build({
      members: [member('leader-editor', 'Leader kiêm Editor', ['LEADER'])],
      approvedEditorUserIds: ['leader-editor'],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);

    expect(result.members.map((m: any) => m.user_id)).toEqual(['leader-editor']);
  });

  it('member thường (role MEMBER, chưa qua duyệt editor) vẫn hiện như cũ — không bị ẩn nhầm', async () => {
    const { service } = build({
      members: [member('member-1', 'Member chưa duyệt', ['MEMBER'])],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);

    expect(result.members.map((m: any) => m.user_id)).toEqual(['member-1']);
  });
});

/**
 * getApprovedProductLineBreakdown() (private, gọi qua getDashboard → product_by_category) —
 * "SẢN PHẨM" (GMV/Traffic/Profit): xác định ProductLine của mỗi task APPROVED, ưu tiên
 * Task.product_line_id (denormalized), fallback sang product_id/editor_product_id/team_product_id
 * → product_line_id của Product/EditorProduct/TeamProduct tương ứng. Nhãn nhóm ưu tiên
 * ProductLine.video_category, fallback ProductLine.name viết hoa. Task không xác định được dòng
 * sản phẩm nào bị bỏ qua. Xem comment gốc tại tasks.service.ts.
 */
describe('TaskAutoTasksService — product_by_category (qua getDashboard)', () => {
  function build(opts: {
    productBreakdownRows?: any[];
    products?: any[];
    editorProducts?: any[];
    teamProducts?: any[];
    productLines?: any[];
  }) {
    const teamsLed = [
      {
        id: 't-1',
        name: 'Team A',
        members: [{ user_id: 'u1', user: { id: 'u1', full_name: 'A', email: 'a@x.com' } }],
      },
    ];
    const prisma: any = {
      team: { findMany: jest.fn(async () => teamsLed) },
      task: {
        groupBy: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        // Phân biệt lời gọi của getContentFreshnessByAssignee (select assignee_id/content_id/...)
        // với getApprovedProductLineBreakdown (select product_line_id/product_id/...) bằng field
        // đặc trưng trong `select` — 2 hàm đều gọi task.findMany trong cùng Promise.all.
        findMany: jest.fn(async (args: any) => {
          if (args.select?.product_line_id !== undefined) {
            return opts.productBreakdownRows ?? [];
          }
          return [];
        }),
      },
      product: { findMany: jest.fn(async () => opts.products ?? []) },
      editorProduct: { findMany: jest.fn(async () => opts.editorProducts ?? []) },
      teamProduct: { findMany: jest.fn(async () => opts.teamProducts ?? []) },
      editorKpi: { findMany: jest.fn(async () => []) },
      trafficReport: { findMany: jest.fn(async () => []) },
      revenueReport: { groupBy: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => []) },
      editorDailyKpi: { findMany: jest.fn(async () => []) },
      productLine: { findMany: jest.fn(async () => opts.productLines ?? []) },
      contentCreatorKpi: { findMany: jest.fn(async () => []) },
      editorApproval: { findMany: jest.fn(async () => []) },
      teamContent: { groupBy: jest.fn(async () => []) },
      contentCreatorDailyKpi: { findMany: jest.fn(async () => []) },
      teamPushRequest: { groupBy: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  async function productByCategory(service: TaskAutoTasksService) {
    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    return result.product_by_category as { category: string; count: number }[];
  }

  it('task có product_line_id denormalized → đếm thẳng, ưu tiên video_category', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: 'pl-1', product_id: null, editor_product_id: null, team_product_id: null },
      ],
      productLines: [{ id: 'pl-1', name: 'Dòng GMV', video_category: 'GMV' }],
    });

    const result = await productByCategory(service);

    expect(result).toEqual([{ category: 'GMV', count: 1 }]);
  });

  it('ProductLine không set video_category → fallback về name viết hoa', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: 'pl-2', product_id: null, editor_product_id: null, team_product_id: null },
      ],
      productLines: [{ id: 'pl-2', name: 'traffic', video_category: null }],
    });

    const result = await productByCategory(service);

    expect(result).toEqual([{ category: 'TRAFFIC', count: 1 }]);
  });

  it('task chỉ có product_id → tra product_line_id qua Product, rồi resolve category', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: null, product_id: 'p-1', editor_product_id: null, team_product_id: null },
      ],
      products: [{ id: 'p-1', product_line_id: 'pl-1' }],
      productLines: [{ id: 'pl-1', name: 'Dòng GMV', video_category: 'GMV' }],
    });

    const result = await productByCategory(service);

    expect(result).toEqual([{ category: 'GMV', count: 1 }]);
  });

  it('task chỉ có editor_product_id → tra qua EditorProduct', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: null, product_id: null, editor_product_id: 'ep-1', team_product_id: null },
      ],
      editorProducts: [{ id: 'ep-1', product_line_id: 'pl-3' }],
      productLines: [{ id: 'pl-3', name: 'Dòng Profit', video_category: 'PROFIT' }],
    });

    const result = await productByCategory(service);

    expect(result).toEqual([{ category: 'PROFIT', count: 1 }]);
  });

  it('task chỉ có team_product_id → tra qua TeamProduct', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: null, product_id: null, editor_product_id: null, team_product_id: 'tp-1' },
      ],
      teamProducts: [{ id: 'tp-1', product_line_id: 'pl-1' }],
      productLines: [{ id: 'pl-1', name: 'Dòng GMV', video_category: 'GMV' }],
    });

    const result = await productByCategory(service);

    expect(result).toEqual([{ category: 'GMV', count: 1 }]);
  });

  it('task không xác định được dòng sản phẩm nào → bị bỏ qua, không tính vào mẫu số', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: null, product_id: null, editor_product_id: null, team_product_id: null },
        { product_line_id: 'pl-missing', product_id: null, editor_product_id: null, team_product_id: null },
      ],
      productLines: [],
    });

    const result = await productByCategory(service);

    expect(result).toEqual([]);
  });

  it('gộp đúng nhiều task cùng category, khác nguồn liên kết (product_line_id lẫn product_id)', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: 'pl-1', product_id: null, editor_product_id: null, team_product_id: null },
        { product_line_id: null, product_id: 'p-1', editor_product_id: null, team_product_id: null },
        { product_line_id: null, product_id: null, editor_product_id: null, team_product_id: 'tp-1' },
      ],
      products: [{ id: 'p-1', product_line_id: 'pl-1' }],
      teamProducts: [{ id: 'tp-1', product_line_id: 'pl-2' }],
      productLines: [
        { id: 'pl-1', name: 'Dòng GMV', video_category: 'GMV' },
        { id: 'pl-2', name: 'Dòng Traffic', video_category: 'TRAFFIC' },
      ],
    });

    const result = await productByCategory(service);

    expect(result).toEqual(
      expect.arrayContaining([
        { category: 'GMV', count: 2 },
        { category: 'TRAFFIC', count: 1 },
      ]),
    );
    expect(result).toHaveLength(2);
  });
});

/**
 * getContentFreshnessByAssignee() (private, gọi qua getDashboard/getTeamReport) — "content mới" vs
 * "content cũ" trong 1 kỳ lọc (tháng báo cáo của leader dashboard): content đã dùng trong task
 * (Content.created_at / EditorContent.added_at / TeamContent.added_at — đúng 1 trong 3 field được
 * set trên mỗi task) được thêm vào kho ĐÚNG TRONG kỳ đang xem → "mới". Mọi task còn lại trong kỳ —
 * content thêm từ trước kỳ, hoặc task không gắn content nào — đều tính là "cũ". Xem comment gốc tại
 * tasks.service.ts.
 */
describe('TaskAutoTasksService — content_new / content_old (qua getDashboard)', () => {
  // getDashboard không truyền `month` → BE mặc định về tháng thực tế hiện tại — nên mốc "trong kỳ"/
  // "trước kỳ" phải tính tương đối theo tháng thực tế lúc chạy test, không hard-code ngày cụ thể.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const IN_PERIOD_CONTENT = new Date(monthStart.getTime() + 2 * 86_400_000); // vài ngày sau đầu tháng
  const BEFORE_PERIOD_CONTENT = new Date(monthStart.getTime() - 86_400_000); // ngày cuối tháng trước
  const TASK_CREATED_AT = new Date(monthStart.getTime() + 3 * 86_400_000); // không còn ảnh hưởng tới mới/cũ

  function build(opts: {
    taskRows?: any[];
    contents?: any[];
    editorContents?: any[];
    teamContents?: any[];
  } = {}) {
    const teamsLed = [
      {
        id: 't-1',
        name: 'Content Team A',
        members: [
          { user_id: 'creator-1', user: { id: 'creator-1', full_name: 'A', email: 'a@x.com' } },
        ],
      },
    ];
    const prisma: any = {
      team: { findMany: jest.fn(async () => teamsLed) },
      task: {
        groupBy: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => (opts.taskRows === undefined ? [] : opts.taskRows)),
      },
      content: {
        findMany: jest.fn(async () => (opts.contents === undefined ? [] : opts.contents)),
      },
      editorContent: {
        findMany: jest.fn(async () => (opts.editorContents === undefined ? [] : opts.editorContents)),
      },
      teamContent: {
        findMany: jest.fn(async () => (opts.teamContents === undefined ? [] : opts.teamContents)),
        groupBy: jest.fn(async () => []),
      },
      editorKpi: { findMany: jest.fn(async () => []) },
      trafficReport: { findMany: jest.fn(async () => []) },
      revenueReport: { groupBy: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => []) },
      editorDailyKpi: { findMany: jest.fn(async () => []) },
      productLine: { findMany: jest.fn(async () => []) },
      contentCreatorKpi: { findMany: jest.fn(async () => []) },
      editorApproval: { findMany: jest.fn(async () => []) },
      contentCreatorDailyKpi: { findMany: jest.fn(async () => []) },
      teamPushRequest: { groupBy: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  async function memberOf(result: any, userId: string) {
    return result.members.find((m: any) => m.user_id === userId);
  }

  afterEach(() => jest.clearAllMocks());

  it('content thêm vào kho trong đúng kỳ đang xem (qua content_id) → tính là "mới"', async () => {
    const { service } = build({
      taskRows: [
        {
          assignee_id: 'creator-1',
          created_at: TASK_CREATED_AT,
          content_id: 'c-1',
          editor_content_id: null,
          team_content_id: null,
        },
      ],
      contents: [{ id: 'c-1', created_at: IN_PERIOD_CONTENT }],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(1);
    expect(member.content_old).toBe(0);
  });

  it('content được thêm từ TRƯỚC kỳ đang xem (qua team_content_id) → tính là "cũ"', async () => {
    const { service } = build({
      taskRows: [
        {
          assignee_id: 'creator-1',
          created_at: TASK_CREATED_AT,
          content_id: null,
          editor_content_id: null,
          team_content_id: 'tc-1',
        },
      ],
      teamContents: [{ id: 'tc-1', added_at: BEFORE_PERIOD_CONTENT }],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(0);
    expect(member.content_old).toBe(1);
  });

  it('lấy ngày qua editor_content_id khi đó là field duy nhất được set', async () => {
    const { service } = build({
      taskRows: [
        {
          assignee_id: 'creator-1',
          created_at: TASK_CREATED_AT,
          content_id: null,
          editor_content_id: 'ec-1',
          team_content_id: null,
        },
      ],
      editorContents: [{ id: 'ec-1', added_at: IN_PERIOD_CONTENT }],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(1);
  });

  it('task không có assignee → bị bỏ qua, không tính vào ai cả', async () => {
    const { service } = build({
      taskRows: [
        {
          assignee_id: null,
          created_at: TASK_CREATED_AT,
          content_id: 'c-1',
          editor_content_id: null,
          team_content_id: null,
        },
      ],
      contents: [{ id: 'c-1', created_at: IN_PERIOD_CONTENT }],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(0);
    expect(member.content_old).toBe(0);
  });

  it('task không gắn content nào (hoặc content bị xoá/thiếu liên kết) → tính là "cũ", không bị loại khỏi mẫu số', async () => {
    const { service } = build({
      taskRows: [
        {
          assignee_id: 'creator-1',
          created_at: TASK_CREATED_AT,
          content_id: 'c-deleted',
          editor_content_id: null,
          team_content_id: null,
        },
      ],
      contents: [], // c-deleted không tồn tại trong bảng content nữa
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(0);
    expect(member.content_old).toBe(1);
  });

  it('gộp đúng nhiều task cho cùng 1 assignee, cả mới lẫn cũ (kể cả task không gắn content)', async () => {
    const { service } = build({
      taskRows: [
        { assignee_id: 'creator-1', created_at: TASK_CREATED_AT, content_id: 'c-1', editor_content_id: null, team_content_id: null },
        { assignee_id: 'creator-1', created_at: TASK_CREATED_AT, content_id: 'c-2', editor_content_id: null, team_content_id: null },
        { assignee_id: 'creator-1', created_at: TASK_CREATED_AT, content_id: 'c-3', editor_content_id: null, team_content_id: null },
        { assignee_id: 'creator-1', created_at: TASK_CREATED_AT, content_id: null, editor_content_id: null, team_content_id: null },
      ],
      contents: [
        { id: 'c-1', created_at: IN_PERIOD_CONTENT },
        { id: 'c-2', created_at: IN_PERIOD_CONTENT },
        { id: 'c-3', created_at: BEFORE_PERIOD_CONTENT },
      ],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(2);
    expect(member.content_old).toBe(2);
  });
});

/**
 * traffic_month (getLeaderDashboard/getTeamReport) — bug gốc: TrafficReport là "điểm cuối kỳ" (mỗi
 * lần nộp báo cáo tạo NHIỀU dòng cùng 1 `date`, 1 dòng/nền tảng), nhưng code cũ SUM `total_traffic`
 * qua TẤT CẢ các ngày trong tháng (groupBy + _sum), làm traffic tháng bị cộng dồn sai — càng nhiều
 * ngày báo cáo thì số càng phồng lên. Traffic đúng của cả kỳ phải là tổng traffic đúng NGÀY BÁO CÁO
 * GẦN NHẤT của từng người (vd traffic tháng 8 = tổng traffic ngày 31/8), không phải sum cả tháng.
 */
describe('TaskAutoTasksService — traffic_month lấy đúng ngày báo cáo gần nhất, không cộng dồn cả tháng', () => {
  function build(trafficRows: any[]) {
    const teamsLed = [
      {
        id: 't-1',
        name: 'Team A',
        members: [
          { user_id: 'u1', user: { id: 'u1', full_name: 'A', email: 'a@x.com' } },
        ],
      },
    ];
    const prisma: any = {
      team: { findMany: jest.fn(async () => teamsLed) },
      task: {
        groupBy: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
      editorKpi: { findMany: jest.fn(async () => []) },
      trafficReport: { findMany: jest.fn(async () => trafficRows) },
      revenueReport: { groupBy: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => []) },
      editorDailyKpi: { findMany: jest.fn(async () => []) },
      productLine: { findMany: jest.fn(async () => []) },
      contentCreatorKpi: { findMany: jest.fn(async () => []) },
      editorApproval: { findMany: jest.fn(async () => []) },
      teamContent: { groupBy: jest.fn(async () => []) },
      contentCreatorDailyKpi: { findMany: jest.fn(async () => []) },
      teamPushRequest: { groupBy: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  it('nhiều ngày báo cáo trong tháng → chỉ lấy ngày gần nhất, không cộng dồn cả tháng', async () => {
    const { service } = build([
      { email: 'a@x.com', date: new Date('2026-08-01T05:00:00Z'), total_traffic: 100n },
      { email: 'a@x.com', date: new Date('2026-08-15T05:00:00Z'), total_traffic: 200n },
      { email: 'a@x.com', date: new Date('2026-08-31T05:00:00Z'), total_traffic: 300n },
    ]);

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, '2026-08');
    const member = result.members.find((m: any) => m.user_id === 'u1');

    // Sai (cộng dồn cả tháng) sẽ ra 600 (100+200+300) — đúng phải là 300 (chỉ ngày 31/8).
    expect(member.traffic_month).toBe(300);
  });

  it('ngày báo cáo gần nhất có nhiều dòng (1 dòng/nền tảng) → SUM đúng các dòng CÙNG ngày đó', async () => {
    const { service } = build([
      { email: 'a@x.com', date: new Date('2026-08-01T05:00:00Z'), total_traffic: 999n },
      // Ngày báo cáo gần nhất (31/8) có 3 dòng — mỗi dòng là 1 nền tảng (fb/ig/tiktok...).
      { email: 'a@x.com', date: new Date('2026-08-31T05:00:00Z'), total_traffic: 100n },
      { email: 'a@x.com', date: new Date('2026-08-31T05:00:00Z'), total_traffic: 200n },
      { email: 'a@x.com', date: new Date('2026-08-31T05:00:00Z'), total_traffic: 300n },
    ]);

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, '2026-08');
    const member = result.members.find((m: any) => m.user_id === 'u1');

    expect(member.traffic_month).toBe(600);
  });

  it('không có báo cáo nào trong kỳ → traffic_month = 0', async () => {
    const { service } = build([]);

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, '2026-08');
    const member = result.members.find((m: any) => m.user_id === 'u1');

    expect(member.traffic_month).toBe(0);
  });
});
