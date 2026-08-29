import { BadRequestException } from '@nestjs/common';
import { TaskAutoTasksService } from '../tasks.service';

// Thiếu cả task.result_url (Drive) lẫn dto.result_url (link tay) → BadRequestException, không đụng DB.
describe('TaskAutoTasksService.submit — bắt buộc có video trước khi nộp', () => {
  function build(task: any) {
    const prisma: any = {
      task: {
        findUnique: jest.fn(async () => task),
        update: jest.fn(async () => ({ team: { leader_id: null } })),
      },
    };
    const service = new TaskAutoTasksService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  }

  it('không có task.result_url và dto.result_url trống → BadRequestException, không update', async () => {
    const { service, prisma } = build({
      assignee_id: 'user-1',
      status: 'ASSIGNED',
      result_url: null,
    });

    await expect(service.submit('task-1', {}, 'user-1')).rejects.toThrow(BadRequestException);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('nhập link video tay (dto.result_url) → cho nộp, update status SUBMITTED', async () => {
    const { service, prisma } = build({
      assignee_id: 'user-1',
      status: 'IN_PROGRESS',
      result_url: null,
    });

    await service.submit('task-1', { result_url: 'https://youtu.be/abc' }, 'user-1');

    expect(prisma.task.update).toHaveBeenCalledTimes(1);
    expect(prisma.task.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'SUBMITTED', result_url: 'https://youtu.be/abc' }),
    );
  });

  it('đã có video trên Drive (task.result_url) dù dto trống → vẫn cho nộp', async () => {
    const { service, prisma } = build({
      assignee_id: 'user-1',
      status: 'ASSIGNED',
      result_url: 'https://drive.google.com/file/d/xyz',
    });

    await service.submit('task-1', {}, 'user-1');

    expect(prisma.task.update).toHaveBeenCalledTimes(1);
  });
});
