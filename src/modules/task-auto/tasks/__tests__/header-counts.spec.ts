import { TaskAutoTasksService } from '../tasks.service';
import { ContentApprovalService } from '../content-approval.service';

/**
 * GET tasks/header-counts — gộp 3 lượt đếm (header "N task" + 2 badge "Video chờ duyệt"/"Content
 * chờ duyệt") vốn phải gọi 3 request limit:1 riêng thành 1 request duy nhất. TasksService.
 * getHeaderCounts() trả total/submittedTotal; ContentApprovalService.countPending() trả riêng số
 * content chờ duyệt (khác bảng nên tách service) — controller gộp cả 2 bằng Promise.all.
 */
describe('TaskAutoTasksService.getHeaderCounts', () => {
  function build() {
    const countCalls: any[] = [];
    const prisma: any = {
      task: {
        count: jest.fn(async (args: any) => {
          countCalls.push(args);
          return 0;
        }),
      },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any);
    return { service, countCalls };
  }

  it('không truyền gì → total đếm toàn bộ, submittedTotal luôn khoá status SUBMITTED', async () => {
    const { service, countCalls } = build();

    await service.getHeaderCounts({} as any);

    expect(countCalls[0].where).toEqual({});
    expect(countCalls[1].where).toEqual({ status: 'SUBMITTED' });
  });

  it('team_id/assignee_id/search/task_type áp dụng cho cả 2 lượt đếm', async () => {
    const { service, countCalls } = build();

    await service.getHeaderCounts({
      team_id: 'team-1',
      assignee_id: 'user-1',
      search: 'abc',
      task_type: 'extra',
    } as any);

    expect(countCalls[0].where).toMatchObject({
      team_id: 'team-1',
      assignee_id: 'user-1',
      task_type: 'EXTRA',
      content: { title: { contains: 'abc', mode: 'insensitive' } },
    });
    expect(countCalls[1].where).toMatchObject({
      status: 'SUBMITTED',
      team_id: 'team-1',
      assignee_id: 'user-1',
      content: { title: { contains: 'abc', mode: 'insensitive' } },
    });
  });

  it('deadline_from/to chỉ áp dụng cho total, KHÔNG áp dụng cho submittedTotal', async () => {
    const { service, countCalls } = build();

    await service.getHeaderCounts({
      deadline_from: '2026-08-01',
      deadline_to: '2026-08-31',
    } as any);

    expect(countCalls[0].where.AND).toBeDefined();
    expect(countCalls[1].where).toEqual({ status: 'SUBMITTED' });
  });

  it('pending_from/to chỉ áp dụng cho submittedTotal, KHÔNG áp dụng cho total', async () => {
    const { service, countCalls } = build();

    await service.getHeaderCounts({
      pending_from: '2026-08-10',
      pending_to: '2026-08-20',
    } as any);

    expect(countCalls[0].where).toEqual({});
    expect(countCalls[1].where.AND).toBeDefined();
    expect(countCalls[1].where.status).toBe('SUBMITTED');
  });

  it('status truyền tay chỉ áp dụng cho total (submittedTotal luôn cố định SUBMITTED)', async () => {
    const { service, countCalls } = build();

    await service.getHeaderCounts({ status: 'APPROVED' } as any);

    expect(countCalls[0].where.status).toBe('APPROVED');
    expect(countCalls[1].where.status).toBe('SUBMITTED');
  });
});

describe('ContentApprovalService.countPending', () => {
  function build() {
    const countCalls: any[] = [];
    const prisma: any = {
      taskContentApproval: {
        count: jest.fn(async (args: any) => {
          countCalls.push(args);
          return 0;
        }),
      },
    };
    const service = new ContentApprovalService(prisma, {} as any);
    return { service, countCalls };
  }

  it('luôn khoá status PENDING, không truyền filter khác → where chỉ có status', async () => {
    const { service, countCalls } = build();

    await service.countPending({});

    expect(countCalls[0].where).toEqual({ status: 'PENDING' });
  });

  it('team_id/assignee_id/search lọc qua quan hệ task', async () => {
    const { service, countCalls } = build();

    await service.countPending({ team_id: 'team-1', assignee_id: 'user-1', search: 'abc' });

    expect(countCalls[0].where).toEqual({
      status: 'PENDING',
      task: {
        team_id: 'team-1',
        assignee_id: 'user-1',
        content: { title: { contains: 'abc', mode: 'insensitive' } },
      },
    });
  });
});
