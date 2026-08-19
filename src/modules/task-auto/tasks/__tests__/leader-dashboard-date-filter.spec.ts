import { TaskAutoTasksService } from '../tasks.service';

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
