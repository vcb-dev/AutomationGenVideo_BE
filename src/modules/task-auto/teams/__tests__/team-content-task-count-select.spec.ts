import { TaskAutoTeamsService } from '../teams.service';

// Cả teamContentInclude (chi tiết) lẫn teamContentListSelect (list) phải kèm `_count.tasks`.
describe('TaskAutoTeamsService — select team content kèm _count.tasks', () => {
  const service = new TaskAutoTeamsService({} as any, {} as any) as any;

  it('teamContentInclude có _count.tasks', () => {
    expect(service.teamContentInclude._count).toEqual({ select: { tasks: true } });
  });

  it('teamContentListSelect có _count.tasks', () => {
    expect(service.teamContentListSelect._count).toEqual({ select: { tasks: true } });
  });
});
