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
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
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
    const service = new TaskAutoTasksService(prisma, videoService, push, linkStats, {} as any, {} as any, {} as any);
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
      // Bảng điều khiển task nay kèm số đơn Sapo; nhánh "không lead team nào" phải trả 0 chứ không
      // bỏ trống, để FE không phải phân biệt undefined với 0.
      total_orders: 0,
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
 *
 * Cập nhật 2026-09-10: mọi số liệu "việc làm được trong kỳ" (KPI hoàn thành ngày/tháng, video theo
 * tuyến, sản phẩm theo dòng, content theo phân loại) đổi từ lọc theo `reviewed_at` (ngày duyệt) sang
 * `deadlineWindow` (deadline trong kỳ, chưa đặt deadline thì theo created_at) để khớp mục tiêu KPI
 * (vốn đếm theo deadline) và khớp tab "Nhiệm vụ"/Kanban.
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
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  afterEach(() => jest.clearAllMocks());

  // Cửa sổ ngày chuẩn (deadlineWindow): task "thuộc kỳ" nếu deadline rơi vào khoảng; chưa đặt
  // deadline thì tính theo created_at thay thế.
  const win = (r: { gte: Date; lt: Date }) => ({
    OR: [{ deadline: r }, { deadline: null, created_at: r }],
  });

  it('trang Task Auto truyền date_from/date_to (không có month) → mọi số liệu thực tế trong kỳ lọc theo deadline trong khoảng đó (null→created_at), KHÔNG theo reviewed_at', async () => {
    const { service, prisma } = build();

    await service.getDashboard('leader-1', ['LEADER'], '2026-01-05', '2026-01-10');

    const expectedRange = { gte: new Date(2026, 0, 5), lt: new Date(2026, 0, 11) };

    // Task đã duyệt của cả team (KPI completed) — APPROVED + deadline trong kỳ.
    expect(prisma.task.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'APPROVED', ...win(expectedRange) }),
      }),
    );
    // Task đã duyệt theo từng member (kpi_completed)
    expect(prisma.task.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['assignee_id'],
        where: expect.objectContaining({ status: 'APPROVED', ...win(expectedRange) }),
      }),
    );
    // Video theo tuyến nội dung
    expect(prisma.task.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['content_line_id'],
        where: expect.objectContaining(win(expectedRange)),
      }),
    );
    // Content theo phân loại (getContentByClassification đọc task.findMany, nay theo deadline)
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { notIn: ['CANCELLED'] }, ...win(expectedRange) }),
      }),
    );
    // Sản phẩm theo dòng (getApprovedProductLineBreakdown đọc task.findMany, nay theo deadline)
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'APPROVED', ...win(expectedRange) }),
      }),
    );
    // reviewed_at không còn được dùng làm trục lọc kỳ ở bất kỳ query task nào.
    for (const call of [
      ...prisma.task.count.mock.calls,
      ...prisma.task.groupBy.mock.calls,
      ...prisma.task.findMany.mock.calls,
    ]) {
      expect(call[0]?.where ?? {}).not.toHaveProperty('reviewed_at');
    }
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

  it('trang /dashboard/leader chỉ truyền `month` (không có date_from/date_to) → vẫn dùng nguyên cả tháng đó, lọc theo deadline trong tháng', async () => {
    const { service, prisma } = build();

    await service.getDashboard('leader-1', ['LEADER'], undefined, undefined, '2025-11');

    // Mốc tháng VN: 00:00 +07 = 17:00Z hôm trước (CI chạy UTC).
    const expectedMonthRange = {
      gte: new Date('2025-10-31T17:00:00.000Z'),
      lt: new Date('2025-11-30T17:00:00.000Z'),
    };

    expect(prisma.task.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'APPROVED', ...win(expectedMonthRange) }),
      }),
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
    // Task đã hoàn thành "trong ngày" (kpi_day_completed): APPROVED + deadline rơi vào đúng ngày 18/3
    // (null→created_at) — KHÔNG theo reviewed_at nữa.
    expect(prisma.task.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['assignee_id'],
        where: expect.objectContaining({ status: 'APPROVED', ...win(day) }),
      }),
    );
    // Mục tiêu KPI ngày (fallback): cùng cửa sổ deadline ngày đó, chỉ khác là chưa lọc APPROVED.
    expect(prisma.task.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['assignee_id'],
        where: expect.objectContaining({ status: { notIn: ['CANCELLED'] }, ...win(day) }),
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
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
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
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
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
      editorDailyKpi: { findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _sum: { target: null } })) },
      productLine: { findMany: jest.fn(async () => []) },
      // computeEditorKpiActuals()
      product: { findMany: jest.fn(async () => []) },
      editorProduct: { findMany: jest.fn(async () => []) },
      teamProduct: { findMany: jest.fn(async () => []) },
      contentCreatorKpi: { findMany: jest.fn(async () => []) },
      editorApproval: { findMany: jest.fn(async () => []) },
      contentCreatorDailyKpi: { findMany: jest.fn(async () => []) },
      teamPushRequest: { groupBy: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
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

  // getPersonalDashboard (MEMBER) cũng trả content_by_classification — cùng helper, `where` khoá theo
  // assignee_id của chính mình + cửa sổ deadline, để trang Tổng quan cá nhân có biểu đồ phân bổ content.
  it('personal (MEMBER) → content_by_classification khoá theo assignee_id chính mình', async () => {
    const taskFindMany = jest.fn(async (args: any) =>
      // getContentByClassification đọc task.findMany với select content_id/editor_content_id/team_content_id
      args.select?.content_id !== undefined
        ? [
            { content_id: 'c-1', editor_content_id: null, team_content_id: null },
            { content_id: 'c-2', editor_content_id: null, team_content_id: null },
            { content_id: null, editor_content_id: null, team_content_id: null },
          ]
        : [],
    );
    const prisma: any = {
      task: {
        groupBy: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        findMany: taskFindMany,
      },
      content: {
        findMany: jest.fn(async () => [
          { id: 'c-1', classification: { name: 'Win' } },
          { id: 'c-2', classification: { name: 'Win' } },
        ]),
      },
      editorContent: { findMany: jest.fn(async () => []) },
      teamContent: { findMany: jest.fn(async () => []) },
      editorKpi: { findMany: jest.fn(async () => []) },
      editorDailyKpi: { aggregate: jest.fn(async () => ({ _sum: { target: null } })) },
      // getPersonalDashboard tra email để khớp TrafficReport
      user: { findUnique: jest.fn(async () => ({ email: 'me@x.com' })) },
      trafficReport: { findMany: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => []) },
      // computeEditorKpiActuals()
      productLine: { findMany: jest.fn(async () => []) },
      product: { findMany: jest.fn(async () => []) },
      editorProduct: { findMany: jest.fn(async () => []) },
      teamProduct: { findMany: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const result: any = await service.getDashboard('me-1', ['MEMBER']);

    expect(result.scope).toBe('personal');
    expect(result.content_by_classification).toEqual([
      { classification: 'Win', count: 2 },
      { classification: 'Chưa phân loại', count: 1 },
    ]);
    // where của task.findMany (getContentByClassification) phải khoá theo chính assignee, không phải team.
    const clsCall = taskFindMany.mock.calls.find((c: any) => c[0]?.select?.content_id !== undefined);
    expect(clsCall?.[0].where).toEqual(
      expect.objectContaining({ assignee_id: 'me-1', status: { notIn: ['CANCELLED'] } }),
    );
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
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
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

/**
 * Mỗi lần nộp báo cáo tạo nhiều dòng cùng 1 ngày (1 dòng / nền tảng × kênh) nên phải gộp theo
 * (người, ngày) và KHÔNG cộng qua nhiều ngày — traffic là điểm cuối kỳ.
 */
describe('TaskAutoTasksService.getTrafficReportsForRole — traffic theo từng nền tảng', () => {
  function build(trafficRows: any[], opts: { self?: any; teamsLed?: any[] } = {}) {
    const prisma: any = {
      trafficReport: { findMany: jest.fn(async () => trafficRows) },
      user: { findUnique: jest.fn(async () => opts.self ?? null) },
      team: { findMany: jest.fn(async () => opts.teamsLed ?? []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  it('gộp các dòng CÙNG (người, ngày) thành 1 dòng tách theo nền tảng, không cộng qua nhiều ngày', async () => {
    const { service } = build([
      // Một lần nộp ngày 31/8: 3 dòng, mỗi dòng 1 nền tảng × 1 kênh (2 kênh Facebook).
      { date: new Date('2026-08-31T05:00:00Z'), email: 'A@x.com', name: 'A', team: 'Team A', traffic_fb: 100n, channel_fb: 'Page 1', total_traffic: 100n },
      { date: new Date('2026-08-31T05:00:00Z'), email: 'a@x.com', name: 'A', team: 'Team A', traffic_fb: 50n, channel_fb: 'Page 2', total_traffic: 50n },
      { date: new Date('2026-08-31T05:00:00Z'), email: 'a@x.com', name: 'A', team: 'Team A', traffic_yt: 30n, channel_yt: 'Kênh YT', total_traffic: 30n },
      // Ngày khác của cùng người → PHẢI là dòng riêng, không dồn vào ngày 31/8.
      { date: new Date('2026-08-01T05:00:00Z'), email: 'a@x.com', name: 'A', team: 'Team A', traffic_tiktok: 7n, channel_tiktok: 'TikTok', total_traffic: 7n },
    ]);

    const res: any = await service.getTrafficReportsForRole('admin-1', ['ADMIN'], '2026-08-01', '2026-08-31');

    expect(res.range).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(res.rows).toHaveLength(2);

    const [latest, oldest] = res.rows; // sắp xếp ngày giảm dần
    expect(latest).toMatchObject({
      date: '2026-08-31',
      email: 'a@x.com', // email chuẩn hoá thường → 'A@x.com' và 'a@x.com' là cùng một người
      name: 'A',
      team: 'Team A',
      fb: 150,
      yt: 30,
      ig: 0,
      tiktok: 0,
      thread: 0,
      zalo: 0,
      total: 180,
    });
    expect(latest.details).toEqual([
      { platform: 'fb', channel: 'Page 1', value: 100 },
      { platform: 'fb', channel: 'Page 2', value: 50 },
      { platform: 'yt', channel: 'Kênh YT', value: 30 },
    ]);
    expect(oldest).toMatchObject({ date: '2026-08-01', tiktok: 7, total: 7 });

    // BigInt lọt ra ngoài sẽ làm JSON.stringify của Nest ném "Do not know how to serialize a BigInt".
    expect(() => JSON.stringify(res)).not.toThrow();
  });

  it('nới truy vấn ±1 ngày nhưng vẫn cắt theo NGÀY GIỜ VN — báo cáo ngoài khoảng bị loại', async () => {
    const { service, prisma } = build([
      { date: new Date('2026-08-31T05:00:00Z'), email: 'a@x.com', name: 'A', traffic_fb: 10n, total_traffic: 10n },
      // 1/9 giờ VN — lọt vào truy vấn do nới ±1 ngày, nhưng ngoài khoảng 1/8–31/8 nên phải bị loại.
      { date: new Date('2026-09-01T05:00:00Z'), email: 'a@x.com', name: 'A', traffic_fb: 999n, total_traffic: 999n },
    ]);

    const res: any = await service.getTrafficReportsForRole('admin-1', ['ADMIN'], '2026-08-01', '2026-08-31');

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ date: '2026-08-31', fb: 10 });

    const where = prisma.trafficReport.findMany.mock.calls[0][0].where;
    expect(where.date.gte).toEqual(new Date(new Date(2026, 7, 1).getTime() - 86_400_000));
    expect(where.date.lt).toEqual(new Date(new Date(2026, 8, 1).getTime() + 86_400_000));
    expect(where.email).toBeUndefined(); // ADMIN không bị khoá theo email
  });

  it('không truyền date_from/date_to → mặc định tháng hiện tại THEO GIỜ VN, không quét cả bảng', async () => {
    // 2026-08-31T18:00Z = 01:00 ngày 1/9 giờ VN → phải ra tháng 9, không phải tháng 8.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-31T18:00:00.000Z'));
    try {
      const { service } = build([]);

      const res: any = await service.getTrafficReportsForRole('admin-1', ['ADMIN']);

      expect(res.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('LEADER → chỉ thành viên (các) team mình lead + chính mình', async () => {
    const { service, prisma } = build([], {
      self: { email: 'Leader@x.com' },
      teamsLed: [
        { members: [{ user: { email: 'M1@x.com' } }, { user: { email: 'm2@x.com' } }] },
        { members: [{ user: { email: 'm3@x.com' } }] },
      ],
    });

    await service.getTrafficReportsForRole('leader-1', ['LEADER'], '2026-08-01', '2026-08-31');

    const where = prisma.trafficReport.findMany.mock.calls[0][0].where;
    expect(where.email.in.sort()).toEqual(['leader@x.com', 'm1@x.com', 'm2@x.com', 'm3@x.com']);
    expect(prisma.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leader_id: 'leader-1' } }),
    );
  });

  it('MEMBER hỏi email người khác → rỗng và KHÔNG truy vấn traffic của người đó', async () => {
    const { service, prisma } = build([], { self: { email: 'me@x.com' } });

    const res: any = await service.getTrafficReportsForRole(
      'u-1', ['MEMBER'], '2026-08-01', '2026-08-31', 'nguoikhac@x.com',
    );

    expect(res.rows).toEqual([]);
    expect(prisma.trafficReport.findMany).not.toHaveBeenCalled();
    expect(prisma.team.findMany).not.toHaveBeenCalled(); // không phải leader → khỏi tra team
  });

  it('MEMBER không truyền email → tự khoá về chính mình; ADMIN lọc được email/team cụ thể', async () => {
    const asMember = build([], { self: { email: 'me@x.com' } });
    await asMember.service.getTrafficReportsForRole('u-1', ['MEMBER'], '2026-08-01', '2026-08-31');
    expect(asMember.prisma.trafficReport.findMany.mock.calls[0][0].where.email.in).toEqual(['me@x.com']);

    const asAdmin = build([]);
    await asAdmin.service.getTrafficReportsForRole(
      'admin-1', ['ADMIN'], '2026-08-01', '2026-08-31', ' Nguoi@x.com ', 'Team A',
    );
    const where = asAdmin.prisma.trafficReport.findMany.mock.calls[0][0].where;
    expect(where.email.in).toEqual(['nguoi@x.com']);
    expect(where.team).toEqual({ equals: 'Team A', mode: 'insensitive' });
    expect(asAdmin.prisma.user.findUnique).not.toHaveBeenCalled(); // ADMIN khỏi tra email của chính mình
  });
});

/**
 * video_by_line.target — biểu đồ "Video theo tuyến nội dung" ở trang Tổng quan (leader + editor) nay
 * kèm mục tiêu KPI theo tuyến để FE hiển thị dạng đã-duyệt / mục-tiêu (vd 10/30). Nguồn target =
 * EditorKpiAllocation.quantity (type CONTENT_LINE) của tháng đang xem: editor lấy của chính mình,
 * leader lấy TỔNG của mọi thành viên team. Tuyến chưa phân bổ → target = 0.
 */
describe('TaskAutoTasksService — video_by_line kèm target theo tuyến nội dung', () => {
  const contentLines = [
    { id: 'cl-a1', name: 'A1' },
    { id: 'cl-a2', name: 'A2' },
    { id: 'cl-a3', name: 'A3' },
  ];

  function alloc(name: string, quantity: number) {
    return { type: 'CONTENT_LINE', content_line_id: `cl-${name.toLowerCase()}`, content_line: { id: `cl-${name.toLowerCase()}`, name }, product_line_id: null, product_line: null, quantity };
  }

  it('leader — target mỗi tuyến = TỔNG quantity của mọi thành viên; tuyến chưa phân bổ = 0', async () => {
    const teamsLed = [
      {
        id: 't-1',
        name: 'Team A',
        members: [
          { user_id: 'u1', user: { id: 'u1', full_name: 'A', email: 'a@x.com', roles: [] } },
          { user_id: 'u2', user: { id: 'u2', full_name: 'B', email: 'b@x.com', roles: [] } },
        ],
      },
    ];
    const prisma: any = {
      team: { findMany: jest.fn(async () => teamsLed) },
      task: {
        // getVideoByContentLine: groupBy theo content_line_id → A1 có 3 video đã duyệt, A2/A3 chưa có.
        groupBy: jest.fn(async (args: any) =>
          args.by?.[0] === 'content_line_id' ? [{ content_line_id: 'cl-a1', _count: { id: 3 } }] : [],
        ),
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
      editorKpi: {
        findMany: jest.fn(async () => [
          { user_id: 'u1', total_target: 30, allocations: [alloc('A1', 10), alloc('A2', 20)] },
          { user_id: 'u2', total_target: 15, allocations: [alloc('A1', 5), alloc('A2', 10)] },
        ]),
      },
      trafficReport: { findMany: jest.fn(async () => []) },
      revenueReport: { groupBy: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => contentLines) },
      editorDailyKpi: { findMany: jest.fn(async () => []) },
      productLine: { findMany: jest.fn(async () => []) },
      contentCreatorKpi: { findMany: jest.fn(async () => []) },
      editorApproval: { findMany: jest.fn(async () => []) },
      teamContent: { groupBy: jest.fn(async () => []) },
      contentCreatorDailyKpi: { findMany: jest.fn(async () => []) },
      teamPushRequest: { groupBy: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, '2026-08');

    expect(result.video_by_line).toEqual([
      { line: 'A1', count: 3, target: 15 }, // 10 (u1) + 5 (u2)
      { line: 'A2', count: 0, target: 30 }, // 20 (u1) + 10 (u2)
      { line: 'A3', count: 0, target: 0 }, // chưa ai phân bổ
    ]);
  });

  it('editor — target mỗi tuyến = quantity của CHÍNH mình', async () => {
    const prisma: any = {
      task: {
        groupBy: jest.fn(async (args: any) =>
          args.by?.[0] === 'content_line_id' ? [{ content_line_id: 'cl-a2', _count: { id: 7 } }] : [],
        ),
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
      editorKpi: {
        findMany: jest.fn(async () => [
          {
            user_id: 'u1',
            month: '2026-08',
            total_target: 25,
            kpi_extra: 0, content_new: 0,
            content_paast_analyzed: 0, content_win_cover: 0, product_gmv: 0, product_traffic: 0,
            allocations: [alloc('A1', 5), alloc('A2', 20)],
          },
        ]),
      },
      editorDailyKpi: { aggregate: jest.fn(async () => ({ _sum: { target: null } })) },
      // getPersonalDashboard tra email để khớp TrafficReport
      user: { findUnique: jest.fn(async () => ({ email: 'me@x.com' })) },
      trafficReport: { findMany: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => contentLines) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const result: any = await service.getDashboard('u1', ['EDITOR']);

    expect(result.video_by_line).toEqual([
      { line: 'A1', count: 0, target: 5 },
      { line: 'A2', count: 7, target: 20 },
      { line: 'A3', count: 0, target: 0 },
    ]);
  });

  it('editor — traffic_month lấy tổng của ngày báo cáo gần nhất, không cộng dồn cả kỳ', async () => {
    let trafficArgs: any = null;
    const prisma: any = {
      task: {
        groupBy: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
      content: { findMany: jest.fn(async () => []) },
      editorContent: { findMany: jest.fn(async () => []) },
      teamContent: { findMany: jest.fn(async () => []) },
      productLine: { findMany: jest.fn(async () => []) },
      product: { findMany: jest.fn(async () => []) },
      editorProduct: { findMany: jest.fn(async () => []) },
      teamProduct: { findMany: jest.fn(async () => []) },
      editorKpi: { findMany: jest.fn(async () => []) },
      editorDailyKpi: { aggregate: jest.fn(async () => ({ _sum: { target: null } })) },
      contentLine: { findMany: jest.fn(async () => contentLines) },
      user: { findUnique: jest.fn(async () => ({ email: 'Me@X.com' })) },
      trafficReport: {
        findMany: jest.fn(async (args: any) => {
          trafficArgs = args;
          return [
            // ngày cũ — KHÔNG được cộng vào
            { email: 'me@x.com', date: new Date(2026, 8, 10), total_traffic: 999n },
            // ngày gần nhất: 2 nền tảng, cộng lại = 1500
            { email: 'me@x.com', date: new Date(2026, 8, 20), total_traffic: 1000n },
            { email: 'me@x.com', date: new Date(2026, 8, 20), total_traffic: 500n },
          ];
        }),
      },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const result: any = await service.getDashboard('u1', ['EDITOR']);

    expect(result.traffic_month).toBe(1500);
    // khớp theo email không phân biệt hoa-thường (bảng báo cáo tay, người dùng tự gõ)
    expect(trafficArgs.where.email).toEqual({ equals: 'me@x.com', mode: 'insensitive' });
  });

  it('editor — chưa có báo cáo traffic nào → traffic_month = 0, không lỗi', async () => {
    const prisma: any = {
      task: { groupBy: jest.fn(async () => []), count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      content: { findMany: jest.fn(async () => []) },
      editorContent: { findMany: jest.fn(async () => []) },
      teamContent: { findMany: jest.fn(async () => []) },
      productLine: { findMany: jest.fn(async () => []) },
      product: { findMany: jest.fn(async () => []) },
      editorProduct: { findMany: jest.fn(async () => []) },
      teamProduct: { findMany: jest.fn(async () => []) },
      editorKpi: { findMany: jest.fn(async () => []) },
      editorDailyKpi: { aggregate: jest.fn(async () => ({ _sum: { target: null } })) },
      contentLine: { findMany: jest.fn(async () => contentLines) },
      user: { findUnique: jest.fn(async () => ({ email: null })) },
      trafficReport: { findMany: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const result: any = await service.getDashboard('u1', ['EDITOR']);

    expect(result.traffic_month).toBe(0);
    // user không có email thì khỏi query TrafficReport
    expect(prisma.trafficReport.findMany).not.toHaveBeenCalled();
  });

  it('editor — số thực đạt KPI cá nhân đếm từ task trong tháng, gộp mọi team', async () => {
    let actualTaskArgs: any = null;
    const task = (over: any = {}) => ({
      assignee_id: 'u1',
      team_id: 't-1',
      status: 'APPROVED',
      published_links: [],
      content_id: null,
      editor_content_id: null,
      team_content_id: null,
      product_line_id: null,
      product_id: null,
      editor_product_id: null,
      team_product_id: null,
      ...over,
    });
    const prisma: any = {
      task: {
        groupBy: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        findMany: jest.fn(async (args: any) => {
          if (!args?.where?.AND) return [];
          actualTaskArgs = args.where;
          return [
            task({ content_id: 'c-paast' }),
            task({ content_id: 'c-paast' }),
            // task của TEAM KHÁC vẫn tính, vì dashboard cá nhân không khoá theo team
            task({ team_id: 't-2', content_id: 'c-paast' }),
            task({ content_id: 'c-new', published_links: [{ platform: 'FACEBOOK', url: 'u', stats: { status: 'success', views: 20000 } }] }),
          ];
        }),
      },
      content: {
        findMany: jest.fn(async () => [
          { id: 'c-paast', classification: { name: 'Phân tích theo PAAST' } },
          { id: 'c-new', classification: { name: 'Mới' } },
        ]),
      },
      editorContent: { findMany: jest.fn(async () => []) },
      teamContent: { findMany: jest.fn(async () => []) },
      productLine: { findMany: jest.fn(async () => []) },
      product: { findMany: jest.fn(async () => []) },
      editorProduct: { findMany: jest.fn(async () => []) },
      teamProduct: { findMany: jest.fn(async () => []) },
      editorKpi: {
        findMany: jest.fn(async () => [
          {
            user_id: 'u1',
            month: '2026-08',
            total_target: 25,
            kpi_extra: 0, content_new: 5,
            content_paast_analyzed: 20, content_win_cover: 2,
            product_gmv: 0, product_traffic: 0, product_profit: 0, product_collect_test_win: 0,
            allocations: [],
          },
        ]),
      },
      editorDailyKpi: { aggregate: jest.fn(async () => ({ _sum: { target: null } })) },
      // getPersonalDashboard tra email để khớp TrafficReport
      user: { findUnique: jest.fn(async () => ({ email: 'me@x.com' })) },
      trafficReport: { findMany: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => contentLines) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const result: any = await service.getDashboard('u1', ['EDITOR']);

    expect(result.kpi.content_paast_analyzed).toBe(20);
    expect(result.kpi.content_paast_analyzed_actual).toBe(3);
    expect(result.kpi.content_new_actual).toBe(1);
    expect(result.kpi.content_win_cover_actual).toBe(1);
    expect(result.kpi.total_actual).toBe(4);

    // Chỉ đếm task của chính mình, bỏ CANCELLED, deadline trong tháng (null → created_at)
    expect(actualTaskArgs.AND[0]).toEqual({
      assignee_id: { in: ['u1'] },
      status: { not: 'CANCELLED' },
    });
    expect(actualTaskArgs.AND[1].OR).toEqual([
      { deadline: { gte: expect.any(Date), lt: expect.any(Date) } },
      { deadline: null, created_at: { gte: expect.any(Date), lt: expect.any(Date) } },
    ]);
  });
});
