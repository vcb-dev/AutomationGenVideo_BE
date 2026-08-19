import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { TaskAutoTasksService } from '../tasks.service';

/**
 * remove() (xoá task) — trước đây chặn xoá cả task APPROVED lẫn IN_PROGRESS. Giờ chỉ chặn
 * IN_PROGRESS (đang làm dở, xoá mất công sức) — APPROVED (đã duyệt xong) được phép xoá, vd leader
 * dọn task trùng/nhầm sau khi duyệt. Vẫn giữ nguyên luật phân quyền: LEADER chỉ xoá được task của
 * team mình quản lý; ADMIN/MANAGER xoá được mọi task.
 */
describe('TaskAutoTasksService.remove — chỉ chặn xoá task đang IN_PROGRESS', () => {
  function build(opts: { task?: any; team?: any } = {}) {
    const deleteCalls: any[] = [];
    const prisma: any = {
      task: {
        findUnique: jest.fn(async () =>
          opts.task === undefined
            ? { status: 'APPROVED', team_id: 'team-1' }
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
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any);
    return { service, prisma, deleteCalls };
  }

  it('task APPROVED → cho phép xoá (trước đây bị chặn)', async () => {
    const { service, prisma, deleteCalls } = build({ task: { status: 'APPROVED', team_id: 'team-1' } });

    const result = await service.remove('task-1', 'leader-1', ['LEADER']);

    expect(result).toEqual({ success: true });
    expect(deleteCalls).toEqual([{ where: { id: 'task-1' } }]);
    expect(prisma.task.delete).toHaveBeenCalledTimes(1);
  });

  it('task IN_PROGRESS → vẫn bị chặn xoá', async () => {
    const { service, prisma } = build({ task: { status: 'IN_PROGRESS', team_id: 'team-1' } });

    await expect(service.remove('task-1', 'leader-1', ['LEADER'])).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });

  it('task PENDING/khác trạng thái → vẫn cho phép xoá như trước', async () => {
    const { service, prisma } = build({ task: { status: 'PENDING', team_id: 'team-1' } });

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

  it('LEADER không quản lý team của task → ForbiddenException, không xoá', async () => {
    const { service, prisma } = build({
      task: { status: 'APPROVED', team_id: 'team-1' },
      team: { leader_id: 'leader-other' },
    });

    await expect(service.remove('task-1', 'leader-1', ['LEADER'])).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });

  it('ADMIN xoá được task APPROVED của bất kỳ team nào, không cần kiểm tra leader_id', async () => {
    const { service, prisma } = build({ task: { status: 'APPROVED', team_id: 'team-1' } });

    const result = await service.remove('task-1', 'admin-1', ['ADMIN']);

    expect(result).toEqual({ success: true });
    expect(prisma.team.findUnique).not.toHaveBeenCalled();
  });
});
