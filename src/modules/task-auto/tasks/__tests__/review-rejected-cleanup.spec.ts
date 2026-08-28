import { TaskAutoTasksService } from '../tasks.service';

// REJECTED: result_url = null + huỷ SocialPost PENDING. APPROVED: không đụng cả hai.
describe('TaskAutoTasksService.review — dọn dẹp khi từ chối task', () => {
  function build() {
    const videoService: any = {
      uploadPendingToDrive: jest.fn(async () => undefined),
      deletePendingVideo: jest.fn(async () => undefined),
    };
    const prisma: any = {
      task: {
        findUnique: jest.fn(async () => ({ status: 'SUBMITTED', assignee_id: null })),
        update: jest.fn(async (args: any) => ({ id: 'task-1', ...args.data })),
      },
      socialPost: {
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
    };
    const service = new TaskAutoTasksService(
      prisma,
      videoService,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma, videoService };
  }

  it('REJECTED → result_url = null + huỷ SocialPost PENDING của task', async () => {
    const { service, prisma } = build();

    await service.review('task-1', { action: 'REJECTED', reject_reason: 'mờ' }, 'reviewer-1');

    expect(prisma.task.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'REJECTED', result_url: null }),
    );
    expect(prisma.socialPost.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.socialPost.updateMany.mock.calls[0][0]).toEqual({
      where: { task_id: 'task-1', status: 'PENDING' },
      data: { status: 'CANCELLED', updated_at: expect.any(Date) },
    });
  });

  it('APPROVED → không đụng result_url, không huỷ SocialPost', async () => {
    const { service, prisma, videoService } = build();

    await service.review('task-1', { action: 'APPROVED' }, 'reviewer-1');

    expect(prisma.task.update.mock.calls[0][0].data).not.toHaveProperty('result_url');
    expect(prisma.socialPost.updateMany).not.toHaveBeenCalled();
    expect(videoService.uploadPendingToDrive).toHaveBeenCalledTimes(1);
  });
});
