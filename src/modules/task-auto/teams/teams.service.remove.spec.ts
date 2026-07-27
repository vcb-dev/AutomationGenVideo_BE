import { TaskAutoTeamsService } from './teams.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

/**
 * remove() — xóa team chỉ cho phép khi KHÔNG còn dữ liệu ràng buộc (task, video,
 * case study, hiệu suất editor, clone video, action item, snapshot KPI, buổi họp).
 * Kiểm tra tường minh ở tầng ứng dụng vì DB thật KHÔNG có FK constraint cho các
 * bảng này (schema lệch DB thật) — xem ghi chú trong teams.service.ts.
 */
describe('TaskAutoTeamsService.remove', () => {
  const ALL_ZERO = {
    task: 0, contentVideo: 0, caseStudy: 0, editorPerformance: 0,
    cloneVideo: 0, actionItem: 0, teamKpiSnapshot: 0, meetingSession: 0,
  };

  function build(opts: { team?: any; counts?: Record<string, number> } = {}) {
    const counts = { ...ALL_ZERO, ...(opts.counts || {}) };
    const deletedIds: string[] = [];
    const tx: any = {
      task: { count: jest.fn(async () => counts.task) },
      contentVideo: { count: jest.fn(async () => counts.contentVideo) },
      caseStudy: { count: jest.fn(async () => counts.caseStudy) },
      editorPerformance: { count: jest.fn(async () => counts.editorPerformance) },
      cloneVideo: { count: jest.fn(async () => counts.cloneVideo) },
      actionItem: { count: jest.fn(async () => counts.actionItem) },
      teamKpiSnapshot: { count: jest.fn(async () => counts.teamKpiSnapshot) },
      meetingSession: { count: jest.fn(async () => counts.meetingSession) },
      team: { delete: jest.fn(async ({ where }: any) => { deletedIds.push(where.id); return {}; }) },
    };
    const prisma: any = {
      team: {
        findUnique: jest.fn(async () => (opts.team === undefined
          ? { id: 'team-1', leader_id: 'leader-1', members: [] }
          : opts.team)),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const service = new TaskAutoTeamsService(prisma);
    return { service, prisma, tx, deletedIds };
  }

  afterEach(() => jest.clearAllMocks());

  it('xóa được khi không còn dữ liệu ràng buộc nào', async () => {
    const { service, deletedIds } = build();
    const result = await service.remove('team-1');

    expect(result).toEqual({ success: true });
    expect(deletedIds).toEqual(['team-1']);
  });

  it('chặn xóa khi team còn task, báo lỗi kèm số lượng cụ thể', async () => {
    const { service, deletedIds } = build({ counts: { task: 2 } });

    await expect(service.remove('team-1')).rejects.toThrow(ConflictException);
    await expect(service.remove('team-1')).rejects.toThrow(/2 task/);
    expect(deletedIds).toHaveLength(0);
  });

  it('liệt kê đủ nhiều loại dữ liệu ràng buộc cùng lúc trong message', async () => {
    const { service } = build({ counts: { task: 1, caseStudy: 3 } });

    await expect(service.remove('team-1')).rejects.toThrow(/1 task/);
    await expect(service.remove('team-1')).rejects.toThrow(/3 case study/);
  });

  it('báo lỗi NotFoundException nếu team không tồn tại', async () => {
    const { service } = build({ team: null });

    await expect(service.remove('missing-id')).rejects.toThrow(NotFoundException);
  });
});
