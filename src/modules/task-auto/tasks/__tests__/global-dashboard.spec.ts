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
