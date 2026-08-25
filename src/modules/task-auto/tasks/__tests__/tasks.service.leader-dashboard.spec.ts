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
        // trong phạm vi test file này (xem content-freshness-by-assignee.spec.ts), nhưng thiếu
        // mock này thì suite hỏng ngay ở lời gọi biên dịch được, không phải lúc assert.
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
