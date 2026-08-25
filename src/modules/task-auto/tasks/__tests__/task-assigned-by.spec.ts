import { TaskAutoTasksService } from '../tasks.service';

/**
 * create()/update() ghi cột `assigned_by_id` (migration 20260819_add_task_assigned_by) — luôn set
 * bằng ID của người vừa thực hiện thao tác (creatorId ở create, userId/actor ở update), không phải
 * bằng assignee_id được truyền vào. Nhờ vậy remove() (xem delete-task-status-guard.spec.ts) so sánh
 * assigned_by_id với assignee_id để phân biệt "tự nhận" (bằng nhau) với "được người khác giao"
 * (khác nhau — leader/admin/manager giao tay cho người khác).
 */
describe('TaskAutoTasksService — ghi nhận assigned_by_id ở create()/update()', () => {
  function buildService(opts: {
    task?: any;
    teamMember?: any;
  } = {}) {
    const prisma: any = {
      team: { findUnique: jest.fn(async () => ({ id: 'team-1', name: 'Team 1' })) },
      content: { findUnique: jest.fn(async () => ({ content_line_id: 'cl-1' })) },
      teamMember: {
        findFirst: jest.fn(async () =>
          opts.teamMember === undefined ? { team_id: 'team-1' } : opts.teamMember,
        ),
      },
      task: {
        findUnique: jest.fn(async () => opts.task),
        create: jest.fn(async (args: any) => ({ id: 'task-new', ...args.data })),
        update: jest.fn(async (args: any) => ({
          id: 'task-1',
          ...args.data,
          team: { leader_id: 'leader-1' },
        })),
      },
      notification: { create: jest.fn(async () => ({})) },
    };
    const push: any = { sendToUser: jest.fn(async () => ({})) };
    const service = new TaskAutoTasksService(prisma, {} as any, push, {} as any);
    return { service, prisma };
  }

  describe('create()', () => {
    it('LEADER tạo task và giao tay cho member khác → assigned_by_id = leader (creatorId), khác assignee_id', async () => {
      const { service, prisma } = buildService();

      await service.create(
        { team_id: 'team-1', content_id: 'content-1', assignee_id: 'member-2' } as any,
        'leader-1',
        ['LEADER'],
      );

      const createArgs = prisma.task.create.mock.calls[0][0];
      expect(createArgs.data.assignee_id).toBe('member-2');
      expect(createArgs.data.assigned_by_id).toBe('leader-1');
    });

    it('Member thường tự tạo task cho chính mình (self-claim) → assigned_by_id === assignee_id', async () => {
      const { service, prisma } = buildService();

      await service.create(
        { team_id: 'team-1', content_id: 'content-1' } as any,
        'member-1',
        ['MEMBER'],
      );

      const createArgs = prisma.task.create.mock.calls[0][0];
      expect(createArgs.data.assignee_id).toBe('member-1');
      expect(createArgs.data.assigned_by_id).toBe('member-1');
    });

    it('LEADER tạo task chưa giao ai (PENDING) → assigned_by_id không được set', async () => {
      const { service, prisma } = buildService();

      await service.create(
        { team_id: 'team-1', content_id: 'content-1' } as any,
        'leader-1',
        ['LEADER'],
      );

      const createArgs = prisma.task.create.mock.calls[0][0];
      expect(createArgs.data.assignee_id).toBeUndefined();
      expect(createArgs.data.assigned_by_id).toBeUndefined();
    });
  });

  describe('update()', () => {
    it('LEADER reassign task đang có người khác nhận sang member khác → assigned_by_id = leader (actor), khác assignee_id mới', async () => {
      const { service, prisma } = buildService({
        task: { task_type: 'MANUAL', assignee_id: 'member-1', status: 'ASSIGNED', team_id: 'team-1' },
      });

      await service.update('task-1', { assignee_id: 'member-2' } as any, 'leader-1', ['LEADER']);

      const updateArgs = prisma.task.update.mock.calls[0][0];
      expect(updateArgs.data.assignee_id).toBe('member-2');
      expect(updateArgs.data.assigned_by_id).toBe('leader-1');
    });

    it('Member tự nhận task đang PENDING (chưa ai nhận) → assigned_by_id === assignee_id (chính actor)', async () => {
      const { service, prisma } = buildService({
        task: { task_type: 'MANUAL', assignee_id: null, status: 'PENDING', team_id: 'team-1' },
        teamMember: { team_id: 'team-1' },
      });

      await service.update('task-1', { assignee_id: 'member-1' } as any, 'member-1', ['MEMBER']);

      const updateArgs = prisma.task.update.mock.calls[0][0];
      expect(updateArgs.data.assignee_id).toBe('member-1');
      expect(updateArgs.data.assigned_by_id).toBe('member-1');
    });

    it('LEADER bỏ giao task (assignee_id = null) → assigned_by_id bị xoá theo (null)', async () => {
      const { service, prisma } = buildService({
        task: { task_type: 'MANUAL', assignee_id: 'member-1', status: 'ASSIGNED', team_id: 'team-1' },
      });

      await service.update('task-1', { assignee_id: null } as any, 'leader-1', ['LEADER']);

      const updateArgs = prisma.task.update.mock.calls[0][0];
      expect(updateArgs.data.assignee_id).toBeNull();
      expect(updateArgs.data.assigned_by_id).toBeNull();
    });

    it('Update không đụng tới assignee_id (vd chỉ đổi deadline) → không ghi đè assigned_by_id đang có', async () => {
      const { service, prisma } = buildService({
        task: { task_type: 'MANUAL', assignee_id: 'member-1', status: 'ASSIGNED', team_id: 'team-1' },
      });

      await service.update('task-1', { deadline: '2026-09-01' } as any, 'leader-1', ['LEADER']);

      const updateArgs = prisma.task.update.mock.calls[0][0];
      expect('assigned_by_id' in updateArgs.data).toBe(false);
    });
  });
});
