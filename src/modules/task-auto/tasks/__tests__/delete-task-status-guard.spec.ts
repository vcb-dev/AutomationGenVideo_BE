import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { TaskAutoTasksService } from '../tasks.service';

/**
 * remove() (xoá task) — trước đây chặn xoá task IN_PROGRESS. Giờ được xoá ở mọi trạng thái, kể cả
 * IN_PROGRESS. Luật phân quyền: ADMIN/MANAGER xoá được mọi task; LEADER xoá được task của team mình
 * quản lý; thành viên thường (không có role đặc quyền) chỉ xoá được task do chính mình đảm nhận
 * (assignee_id === requesterId) VÀ task đó do chính mình tự nhận — không phải được leader giao tay
 * (assigned_by_id khác assignee_id) hoặc hệ thống tự động chia (run_id != null).
 */
describe('TaskAutoTasksService.remove — xoá task ở mọi trạng thái, theo đúng phân quyền', () => {
  function build(opts: { task?: any; team?: any } = {}) {
    const deleteCalls: any[] = [];
    const prisma: any = {
      task: {
        findUnique: jest.fn(async () =>
          opts.task === undefined
            ? { status: 'APPROVED', team_id: 'team-1', assignee_id: 'member-1' }
            : opts.task,
        ),
        delete: jest.fn(async (args: any) => {
          deleteCalls.push(args);
          return { id: args.where.id };
        }),
      },
      team: {
        findUnique: jest.fn(async () =>
          opts.team === undefined ? { leader_id: 'leader-1' } : opts.team,
        ),
      },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any);
    return { service, prisma, deleteCalls };
  }

  it('task APPROVED, LEADER quản lý team → cho phép xoá', async () => {
    const { service, prisma, deleteCalls } = build({
      task: { status: 'APPROVED', team_id: 'team-1', assignee_id: 'member-1' },
    });

    const result = await service.remove('task-1', 'leader-1', ['LEADER']);

    expect(result).toEqual({ success: true });
    expect(deleteCalls).toEqual([{ where: { id: 'task-1' } }]);
    expect(prisma.task.delete).toHaveBeenCalledTimes(1);
  });

  it('task IN_PROGRESS → nay cho phép xoá', async () => {
    const { service, prisma } = build({
      task: { status: 'IN_PROGRESS', team_id: 'team-1', assignee_id: 'member-1' },
    });

    const result = await service.remove('task-1', 'leader-1', ['LEADER']);

    expect(result).toEqual({ success: true });
    expect(prisma.task.delete).toHaveBeenCalledTimes(1);
  });

  it('task không tồn tại → NotFoundException', async () => {
    const { service } = build({ task: null });

    await expect(service.remove('task-x', 'leader-1', ['LEADER'])).rejects.toThrow(
      NotFoundException,
    );
  });

  it('LEADER không quản lý team của task, không phải assignee → ForbiddenException, không xoá', async () => {
    const { service, prisma } = build({
      task: { status: 'APPROVED', team_id: 'team-1', assignee_id: 'member-1' },
      team: { leader_id: 'leader-other' },
    });

    await expect(service.remove('task-1', 'leader-1', ['LEADER'])).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });

  it('ADMIN xoá được task IN_PROGRESS của bất kỳ team nào, không cần kiểm tra leader_id', async () => {
    const { service, prisma } = build({
      task: { status: 'IN_PROGRESS', team_id: 'team-1', assignee_id: 'member-1' },
    });

    const result = await service.remove('task-1', 'admin-1', ['ADMIN']);

    expect(result).toEqual({ success: true });
    expect(prisma.team.findUnique).not.toHaveBeenCalled();
  });

  it('Thành viên thường tự xoá task của chính mình (assignee) → cho phép, kể cả IN_PROGRESS', async () => {
    const { service, prisma } = build({
      task: { status: 'IN_PROGRESS', team_id: 'team-1', assignee_id: 'member-1' },
    });

    const result = await service.remove('task-1', 'member-1', ['MEMBER']);

    expect(result).toEqual({ success: true });
    expect(prisma.team.findUnique).not.toHaveBeenCalled();
    expect(prisma.task.delete).toHaveBeenCalledTimes(1);
  });

  it('Thành viên thường xoá task KHÔNG phải của mình → ForbiddenException', async () => {
    const { service, prisma } = build({
      task: { status: 'PENDING', team_id: 'team-1', assignee_id: 'other-member' },
    });

    await expect(service.remove('task-1', 'member-1', ['MEMBER'])).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });

  it('Thành viên thường xoá task của mình nhưng được hệ thống tự động chia (run_id != null) → ForbiddenException', async () => {
    const { service, prisma } = build({
      task: { status: 'ASSIGNED', team_id: 'team-1', assignee_id: 'member-1', run_id: 'run-1' },
    });

    await expect(service.remove('task-1', 'member-1', ['MEMBER'])).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });

  it('Thành viên thường xoá task của mình nhưng được leader giao tay (assigned_by_id khác assignee_id) → ForbiddenException', async () => {
    const { service, prisma } = build({
      task: {
        status: 'ASSIGNED',
        team_id: 'team-1',
        assignee_id: 'member-1',
        assigned_by_id: 'leader-1',
      },
    });

    await expect(service.remove('task-1', 'member-1', ['MEMBER'])).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });

  it('Thành viên thường tự nhận task (assigned_by_id === assignee_id) → vẫn cho phép xoá', async () => {
    const { service, prisma } = build({
      task: {
        status: 'ASSIGNED',
        team_id: 'team-1',
        assignee_id: 'member-1',
        assigned_by_id: 'member-1',
      },
    });

    const result = await service.remove('task-1', 'member-1', ['MEMBER']);

    expect(result).toEqual({ success: true });
    expect(prisma.task.delete).toHaveBeenCalledTimes(1);
  });

  it('LEADER quản lý team → vẫn xoá được task tự động chia/leader giao trong team mình', async () => {
    const { service, prisma } = build({
      task: {
        status: 'ASSIGNED',
        team_id: 'team-1',
        assignee_id: 'member-1',
        run_id: 'run-1',
      },
    });

    const result = await service.remove('task-1', 'leader-1', ['LEADER']);

    expect(result).toEqual({ success: true });
    expect(prisma.task.delete).toHaveBeenCalledTimes(1);
  });
});
