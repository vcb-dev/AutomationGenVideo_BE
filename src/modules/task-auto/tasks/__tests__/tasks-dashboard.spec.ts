import { TaskAutoTasksService } from '../tasks.service';

/**
 * getGlobalDashboard (qua getDashboard cho ADMIN/MANAGER) — bug gốc: breakdown theo trạng thái
 * (`tasks.*`, donut "Phân bố task") lọc theo `created_at` trong kỳ, trong khi tab "Nhiệm vụ"
 * (Kanban/findAll) lọc theo `deadline_from/to` (task chưa có deadline thì theo `created_at` thay
 * thế) và loại trừ task đang xử lý đã quá hạn khỏi các cột thường. Hai dimension khác nhau khiến
 * số liệu "Tổng quan" lệch với "Nhiệm vụ" cùng bộ lọc ngày. Đã sửa để dùng đúng 1 nguồn sự thật
 * (xem `[[task-auto-global-dashboard-live-vs-period-metrics]]`). `today_deadline`/`overdue` luôn
 * tính live theo thời điểm gọi API, KHÔNG phụ thuộc bộ lọc ngày — test này khoá lại cả 2 hành vi.
 */
describe('TaskAutoTasksService.getDashboard (ADMIN/MANAGER) — global dashboard theo bộ lọc ngày', () => {
  function build(tasksByStatus: { status: string; _count: { id: number } }[] = []) {
    const prisma: any = {
      task: {
        groupBy: jest.fn(async (args: any) =>
          args.by[0] === 'status' ? tasksByStatus : [],
        ),
        count: jest.fn(async () => 0),
      },
      user: { count: jest.fn(async () => 0) },
      editorApproval: { count: jest.fn(async () => 0) },
      contentLine: { findMany: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  it('không có bộ lọc ngày → breakdown trạng thái loại trừ task đang xử lý đã quá hạn, không lọc theo created_at', async () => {
    const { service, prisma } = build();

    await service.getDashboard('admin-1', ['ADMIN'], undefined, undefined);

    const statusCall = prisma.task.groupBy.mock.calls.find((c: any[]) => c[0].by[0] === 'status');
    expect(statusCall[0].where).toEqual({
      OR: [
        { status: { in: ['APPROVED', 'CANCELLED'] } },
        { deadline: null },
        { deadline: { gte: expect.any(Date) } },
      ],
    });
  });

  it('có date_from/date_to → breakdown trạng thái lọc theo deadline trong kỳ (null→created_at fallback) VÀ trừ quá hạn, khớp Kanban', async () => {
    const { service, prisma } = build();

    await service.getDashboard('admin-1', ['ADMIN'], '2026-01-05', '2026-01-10');

    const expectedRange = { gte: new Date(2026, 0, 5), lt: new Date(2026, 0, 11) };
    const statusCall = prisma.task.groupBy.mock.calls.find((c: any[]) => c[0].by[0] === 'status');
    expect(statusCall[0].where).toEqual({
      AND: [
        { OR: [{ deadline: expectedRange }, { deadline: null, created_at: expectedRange }] },
        {
          OR: [
            { status: { in: ['APPROVED', 'CANCELLED'] } },
            { deadline: null },
            { deadline: { gte: expect.any(Date) } },
          ],
        },
      ],
    });

    // video_by_line dùng cùng dateWindow (deadline/created_at fallback), không còn lọc theo reviewed_at.
    const lineCall = prisma.task.groupBy.mock.calls.find(
      (c: any[]) => c[0].by[0] === 'content_line_id',
    );
    expect(lineCall[0].where).toEqual(
      expect.objectContaining({
        OR: [{ deadline: expectedRange }, { deadline: null, created_at: expectedRange }],
      }),
    );
  });

  it('monthly_completed khớp 1-1 với tasks.approved (không đếm riêng theo reviewed_at nữa)', async () => {
    const { service } = build([
      { status: 'APPROVED', _count: { id: 7 } },
      { status: 'ASSIGNED', _count: { id: 3 } },
    ]);

    const result: any = await service.getDashboard('admin-1', ['ADMIN'], undefined, undefined);

    expect(result.tasks.approved).toBe(7);
    expect(result.monthly_completed).toBe(7);
  });

  it('today_deadline/overdue luôn tính live theo thời điểm hiện tại, không phụ thuộc date_from/date_to', async () => {
    const { service, prisma } = build();

    await service.getDashboard('admin-1', ['ADMIN'], '2020-01-01', '2020-01-02');

    // 2 lệnh task.count đầu tiên (theo đúng thứ tự khởi tạo trong Promise.all): today_deadline rồi overdue.
    const [todayDeadlineArgs, overdueArgs] = prisma.task.count.mock.calls;
    expect(todayDeadlineArgs[0].where.OR[0].deadline.gte.getFullYear()).not.toBe(2020);
    expect(overdueArgs[0].where.deadline.lt.getFullYear()).not.toBe(2020);
    expect(overdueArgs[0].where).toEqual({
      deadline: { lt: expect.any(Date) },
      status: { notIn: ['APPROVED', 'CANCELLED'] },
    });
  });
});

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
        // getContentByClassification (donut "content theo phân loại") đọc task.findMany — không nằm
        // trong phạm vi describe này (xem describe "content_by_classification" bên dưới), nhưng
        // thiếu mock này thì suite hỏng ngay ở lời gọi, không phải lúc assert.
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
    const service = new TaskAutoTasksService(prisma, videoService, push, linkStats, {} as any);
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
      content_by_classification: [],
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
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any);
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
    // Content theo phân loại (getContentByClassification đọc task.findMany theo created_at)
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

  // Tab "Thống kê theo ngày" của /dashboard/leader: chọn đúng 1 ngày + pin_traffic_month → task đã
  // duyệt "trong ngày" (kpi_day_completed) co về đúng ngày đó, còn traffic/doanh thu vẫn quét cả
  // THÁNG chứa ngày đó (18/3 tránh mọi mốc DST US/EU nên hiệu 2 mốc đúng 24h ở mọi timezone).
  it('pin_traffic_month + chọn đúng 1 ngày → traffic/doanh thu theo tháng, KPI ngày theo đúng ngày đó', async () => {
    const { service, prisma } = build();

    await service.getDashboard('leader-1', ['LEADER'], '2025-03-18', '2025-03-18', undefined, undefined, undefined, true);

    const day = { gte: new Date(2025, 2, 18), lt: new Date(2025, 2, 19) };
    const month = { gte: new Date(2025, 2, 1), lt: new Date(2025, 3, 1) };

    // Traffic + doanh thu: cả tháng 3 chứ không phải riêng ngày 18.
    expect(prisma.trafficReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ date: month }) }),
    );
    expect(prisma.revenueReport.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ date: month }) }),
    );
    // Task đã duyệt "trong ngày" (kpi_day_completed): quy về đúng ngày 18/3.
    expect(prisma.task.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['assignee_id'],
        where: expect.objectContaining({ status: 'APPROVED', reviewed_at: day }),
      }),
    );
  });

  it('không bật pin_traffic_month → traffic/doanh thu vẫn bám theo khoảng ngày như cũ', async () => {
    const { service, prisma } = build();

    await service.getDashboard('leader-1', ['LEADER'], '2025-03-18', '2025-03-18');

    const day = { gte: new Date(2025, 2, 18), lt: new Date(2025, 2, 19) };
    expect(prisma.trafficReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ date: day }) }),
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
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any);
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
        // Phân biệt lời gọi của getContentByClassification (select content_id/editor_content_id/...)
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
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any);
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
 * getContentByClassification() (private, gọi qua getDashboard/getTeamReport) — donut "Content theo
 * phân loại": với mỗi task tạo trong kỳ (call site đã khoá team + created_at + chưa huỷ + assignee
 * thuộc team), lấy ContentClassification HIỆN TẠI của content gắn vào task (content_id → Content,
 * editor_content_id → EditorContent, team_content_id → TeamContent — đúng 1 trong 3 field được set).
 * Task có content chưa gắn phân loại, không gắn content, hoặc content đã bị xoá → dồn vào nhóm "Chưa
 * phân loại". Kết quả ở top level `content_by_classification`, sắp count giảm dần, "Chưa phân loại"
 * luôn xuống cuối. Thay cho biểu đồ "content mới/cũ" (getContentFreshnessByAssignee) đã gỡ.
 */
describe('TaskAutoTasksService — content_by_classification (qua getDashboard)', () => {
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
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  const run = async (service: TaskAutoTasksService) => {
    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    return result.content_by_classification as { classification: string; count: number }[];
  };

  afterEach(() => jest.clearAllMocks());

  it('gộp task theo phân loại của content gắn qua content_id', async () => {
    const { service } = build({
      taskRows: [
        { content_id: 'c-1', editor_content_id: null, team_content_id: null },
        { content_id: 'c-2', editor_content_id: null, team_content_id: null },
      ],
      contents: [
        { id: 'c-1', classification: { name: 'Win' } },
        { id: 'c-2', classification: { name: 'Win' } },
      ],
    });

    expect(await run(service)).toEqual([{ classification: 'Win', count: 2 }]);
  });

  it('phân loại lấy qua editor_content_id / team_content_id khi đó là field được set', async () => {
    const { service } = build({
      taskRows: [
        { content_id: null, editor_content_id: 'ec-1', team_content_id: null },
        { content_id: null, editor_content_id: null, team_content_id: 'tc-1' },
      ],
      editorContents: [{ id: 'ec-1', classification: { name: 'Test' } }],
      teamContents: [{ id: 'tc-1', classification: { name: 'Win' } }],
    });

    expect(await run(service)).toEqual([
      { classification: 'Test', count: 1 },
      { classification: 'Win', count: 1 },
    ]);
  });

  it('content chưa gắn phân loại → nhóm "Chưa phân loại"', async () => {
    const { service } = build({
      taskRows: [{ content_id: 'c-1', editor_content_id: null, team_content_id: null }],
      contents: [{ id: 'c-1', classification: null }],
    });

    expect(await run(service)).toEqual([{ classification: 'Chưa phân loại', count: 1 }]);
  });

  it('task không gắn content, hoặc content đã bị xoá → nhóm "Chưa phân loại", vẫn tính vào mẫu số', async () => {
    const { service } = build({
      taskRows: [
        { content_id: null, editor_content_id: null, team_content_id: null },
        { content_id: 'c-deleted', editor_content_id: null, team_content_id: null },
      ],
      contents: [], // c-deleted không còn trong bảng content
    });

    expect(await run(service)).toEqual([{ classification: 'Chưa phân loại', count: 2 }]);
  });

  it('sắp theo count giảm dần, "Chưa phân loại" luôn xuống cuối dù đông hơn', async () => {
    const { service } = build({
      taskRows: [
        { content_id: 'c-1', editor_content_id: null, team_content_id: null },
        { content_id: 'c-2', editor_content_id: null, team_content_id: null },
        { content_id: 'c-3', editor_content_id: null, team_content_id: null },
        { content_id: null, editor_content_id: null, team_content_id: null },
        { content_id: null, editor_content_id: null, team_content_id: null },
        { content_id: null, editor_content_id: null, team_content_id: null },
        { content_id: null, editor_content_id: null, team_content_id: null },
      ],
      contents: [
        { id: 'c-1', classification: { name: 'Win' } },
        { id: 'c-2', classification: { name: 'Win' } },
        { id: 'c-3', classification: { name: 'Test' } },
      ],
    });

    expect(await run(service)).toEqual([
      { classification: 'Win', count: 2 },
      { classification: 'Test', count: 1 },
      { classification: 'Chưa phân loại', count: 4 },
    ]);
  });

  it('không có task nào trong kỳ → mảng rỗng', async () => {
    const { service } = build({ taskRows: [] });
    expect(await run(service)).toEqual([]);
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
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any);
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
